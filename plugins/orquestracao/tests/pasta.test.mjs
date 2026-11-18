// A pasta de estado do kit mudou de ~/.claude/ichikawa para ~/.claude/matheus-plugins: a migração move o que havia,
// deixa um link no lugar da antiga (para as sessões que ainda rodam a versão velha gravarem no mesmo lugar) e nunca
// apaga um registro — o que existe dos dois lados com conteúdo diferente vai para migracao-conflitos/.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { raiz } from '../lib/estado.mjs';
import { avisoDaMigracao, migrarPastaAntiga, pastaEmUso } from '../lib/migracao.mjs';

let casa;
let antiga;
let nova;
const guardado = {};

beforeEach(() => {
  casa = mkdtempSync(join(tmpdir(), 'pasta-'));
  antiga = join(casa, '.claude', 'ichikawa');
  nova = join(casa, '.claude', 'matheus-plugins');
});

afterEach(() => {
  for (const [nome, valor] of Object.entries(guardado)) {
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
});

const escrever = (caminho, texto) => {
  mkdirSync(join(caminho, '..'), { recursive: true });
  writeFileSync(caminho, texto);
};
const ler = (caminho) => readFileSync(caminho, 'utf8');
const ontem = new Date(Date.now() - 86_400_000);
const sobras = () => readdirSync(join(casa, '.claude')).filter((n) => n.startsWith('ichikawa.migrando-'));
const conflitos = (...partes) => join(nova, 'migracao-conflitos', ...partes);

test('move tudo da pasta antiga para a nova e deixa um link no lugar', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{"id":"F1"}');
  escrever(join(antiga, 'perguntas', 'proj', 'Q1.json'), '{"id":"Q1"}');
  escrever(join(antiga, 'tema.json'), '{"tema":"claro"}');

  assert.equal(migrarPastaAntiga(antiga, nova), 'migrada');

  assert.equal(ler(join(nova, 'itens', 'proj', 'F1.json')), '{"id":"F1"}');
  assert.equal(ler(join(nova, 'perguntas', 'proj', 'Q1.json')), '{"id":"Q1"}');
  assert.equal(ler(join(nova, 'tema.json')), '{"tema":"claro"}');
  assert.ok(lstatSync(antiga).isSymbolicLink(), 'a antiga virou link');
  assert.deepEqual(sobras(), [], 'não sobra pasta de migração');
});

test('quem grava pelo caminho antigo depois da migração (direto ou temporário + rename) grava na pasta nova', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{}');
  migrarPastaAntiga(antiga, nova);

  writeFileSync(join(antiga, 'itens', 'proj', 'F2.json'), '{"id":"F2"}');
  writeFileSync(join(antiga, 'itens', 'proj', 'F3.json.123.tmp'), '{"id":"F3"}');
  renameSync(join(antiga, 'itens', 'proj', 'F3.json.123.tmp'), join(antiga, 'itens', 'proj', 'F3.json'));

  assert.equal(ler(join(nova, 'itens', 'proj', 'F2.json')), '{"id":"F2"}');
  assert.equal(ler(join(nova, 'itens', 'proj', 'F3.json')), '{"id":"F3"}');
});

test('mescla com a pasta nova que já existe sem perder nada: o mais novo fica no lugar, o outro vai para os conflitos', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{"id":"F1"}');
  escrever(join(antiga, 'sessoes-do-app.json'), '{"velho":true}');
  escrever(join(antiga, 'tema.json'), '{"tema":"claro"}');
  escrever(join(antiga, 'ausente.json'), '{"ligado":false}');
  escrever(join(nova, 'itens', 'proj', 'F2.json'), '{"id":"F2"}');
  escrever(join(nova, 'sessoes-do-app.json'), '{"novo":true}');
  escrever(join(nova, 'tema.json'), '{"tema":"escuro"}');
  escrever(join(nova, 'ausente.json'), '{"ligado":false}');
  utimesSync(join(antiga, 'sessoes-do-app.json'), ontem, ontem); // a barra nova gravou depois
  utimesSync(join(nova, 'tema.json'), ontem, ontem); // o tema da antiga é o mais novo

  assert.equal(migrarPastaAntiga(antiga, nova), 'migrada');

  assert.deepEqual(readdirSync(join(nova, 'itens', 'proj')).sort(), ['F1.json', 'F2.json']);
  assert.equal(ler(join(nova, 'sessoes-do-app.json')), '{"novo":true}');
  assert.equal(ler(conflitos('sessoes-do-app.json')), '{"velho":true}');
  assert.equal(ler(join(nova, 'tema.json')), '{"tema":"claro"}');
  assert.equal(ler(conflitos('tema.json')), '{"tema":"escuro"}');
  assert.equal(existsSync(conflitos('ausente.json')), false, 'conteúdo igual não vira conflito');
  assert.ok(lstatSync(antiga).isSymbolicLink());
});

test('dois registros diferentes com o mesmo número: nenhum se perde', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{"id":"F1","titulo":"original"}');
  escrever(join(nova, 'itens', 'proj', 'F1.json'), '{"id":"F1","titulo":"outro"}');

  migrarPastaAntiga(antiga, nova);

  const textos = [ler(join(nova, 'itens', 'proj', 'F1.json')), ler(conflitos('itens', 'proj', 'F1.json'))].sort();
  assert.deepEqual(textos, ['{"id":"F1","titulo":"original"}', '{"id":"F1","titulo":"outro"}']);
});

test('arquivo preso (a antiga não sai do caminho): nada muda e o kit segue na antiga', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{}');
  const preso = () => { throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }); };

  const r = migrarPastaAntiga(antiga, nova, { renomear: preso });

  assert.equal(r, 'adiada');
  assert.equal(pastaEmUso(r, antiga, nova), antiga);
  assert.ok(lstatSync(antiga).isDirectory() && !lstatSync(antiga).isSymbolicLink());
  assert.equal(ler(join(antiga, 'itens', 'proj', 'F1.json')), '{}');
  assert.match(avisoDaMigracao(r, antiga, nova), /arquivo aberto/);
});

test('disco que não aceita link: desfaz o rename e segue na antiga', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{}');
  const semLink = () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); };

  assert.equal(migrarPastaAntiga(antiga, nova, { ligar: semLink }), 'adiada');

  assert.ok(lstatSync(antiga).isDirectory() && !lstatSync(antiga).isSymbolicLink());
  assert.equal(ler(join(antiga, 'itens', 'proj', 'F1.json')), '{}');
  assert.deepEqual(sobras(), []);
});

test('sessão velha recria a antiga entre o rename e o link: as duas viram sobra, e nada se perde', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{"titulo":"original"}');
  let vezes = 0;
  const ligar = (alvo, caminho) => {
    if (vezes++ === 0) {
      escrever(join(caminho, 'itens', 'proj', 'F1.json'), '{"titulo":"da sessão velha"}');
      throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    }
    symlinkSync(alvo, caminho, 'junction');
  };

  assert.equal(migrarPastaAntiga(antiga, nova, { ligar }), 'migrada');

  assert.ok(lstatSync(antiga).isSymbolicLink());
  const textos = [ler(join(nova, 'itens', 'proj', 'F1.json')), ler(conflitos('itens', 'proj', 'F1.json'))].sort();
  assert.deepEqual(textos, ['{"titulo":"da sessão velha"}', '{"titulo":"original"}']);
  assert.deepEqual(sobras(), []);
});

test('migração que morreu entre o rename e o link: a próxima põe o link e termina a mescla', () => {
  escrever(join(casa, '.claude', 'ichikawa.migrando-1-2-0', 'itens', 'proj', 'F1.json'), '{"id":"F1"}');

  assert.equal(migrarPastaAntiga(antiga, nova), 'migrada');

  assert.ok(lstatSync(antiga).isSymbolicLink());
  assert.equal(ler(join(nova, 'itens', 'proj', 'F1.json')), '{"id":"F1"}');
  assert.deepEqual(sobras(), []);
});

test('temporário de gravação pela metade não vai para a nova', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{}');
  escrever(join(antiga, 'itens', 'proj', 'F2.json.999.tmp'), '{');

  assert.equal(migrarPastaAntiga(antiga, nova), 'migrada');

  assert.deepEqual(readdirSync(join(nova, 'itens', 'proj')), ['F1.json']);
});

test('antiga e nova são a mesma pasta (a nova é link para a antiga): não toca em nada', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{"id":"F1"}');
  symlinkSync(antiga, nova, 'junction');

  assert.equal(migrarPastaAntiga(antiga, nova), 'mesma-pasta');

  assert.equal(ler(join(antiga, 'itens', 'proj', 'F1.json')), '{"id":"F1"}');
});

test('antiga é link para outro lugar: não migra, segue nela e avisa', () => {
  const outro = join(casa, 'sincronizada');
  escrever(join(outro, 'itens', 'proj', 'F1.json'), '{}');
  mkdirSync(join(casa, '.claude'), { recursive: true });
  symlinkSync(outro, antiga, 'junction');

  const r = migrarPastaAntiga(antiga, nova);

  assert.equal(r, 'link-alheio');
  assert.equal(pastaEmUso(r, antiga, nova), antiga);
  assert.equal(existsSync(nova), false);
  assert.ok(avisoDaMigracao(r, antiga, nova));
});

test('sem pasta antiga, ou já migrada, não faz nada', () => {
  assert.equal(migrarPastaAntiga(antiga, nova), 'sem-antiga');
  assert.equal(existsSync(nova), false, 'não cria a nova à toa');

  escrever(join(antiga, 'tema.json'), '{}');
  migrarPastaAntiga(antiga, nova);
  assert.equal(migrarPastaAntiga(antiga, nova), 'ja-migrada');
  assert.equal(avisoDaMigracao('ja-migrada', antiga, nova), null);
});

test('raiz() migra a pasta antiga da casa quando não há MATHEUS_PLUGINS_HOME', () => {
  for (const nome of ['MATHEUS_PLUGINS_HOME', 'HOME', 'USERPROFILE']) guardado[nome] = process.env[nome];
  delete process.env.MATHEUS_PLUGINS_HOME;
  process.env.HOME = casa;
  process.env.USERPROFILE = casa;
  escrever(join(antiga, 'ausente.json'), '{"ligado":true}');

  assert.equal(raiz(), nova);

  assert.equal(ler(join(nova, 'ausente.json')), '{"ligado":true}');
  assert.ok(lstatSync(antiga).isSymbolicLink());
});

test('raiz() com MATHEUS_PLUGINS_HOME usa a pasta dada e não toca na antiga', () => {
  for (const nome of ['MATHEUS_PLUGINS_HOME', 'HOME', 'USERPROFILE']) guardado[nome] = process.env[nome];
  process.env.HOME = casa;
  process.env.USERPROFILE = casa;
  process.env.MATHEUS_PLUGINS_HOME = join(casa, 'teste');
  escrever(join(antiga, 'ausente.json'), '{}');

  assert.equal(raiz(), join(casa, 'teste'));

  assert.equal(lstatSync(antiga).isDirectory(), true);
  assert.equal(existsSync(nova), false);
});

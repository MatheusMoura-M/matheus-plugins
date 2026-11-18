// A pasta de estado do kit mudou de ~/.claude/ichikawa para ~/.claude/matheus-plugins: a migração move o que havia e
// deixa um link no lugar da antiga, para as sessões que ainda rodam a versão velha gravarem no mesmo lugar.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrarPastaAntiga, raiz } from '../lib/estado.mjs';

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

test('move tudo da pasta antiga para a nova e deixa um link no lugar', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{"id":"F1"}');
  escrever(join(antiga, 'perguntas', 'proj', 'Q1.json'), '{"id":"Q1"}');
  escrever(join(antiga, 'tema.json'), '{"tema":"claro"}');

  assert.equal(migrarPastaAntiga(antiga, nova), 'migrada');

  assert.equal(readFileSync(join(nova, 'itens', 'proj', 'F1.json'), 'utf8'), '{"id":"F1"}');
  assert.equal(readFileSync(join(nova, 'perguntas', 'proj', 'Q1.json'), 'utf8'), '{"id":"Q1"}');
  assert.equal(readFileSync(join(nova, 'tema.json'), 'utf8'), '{"tema":"claro"}');
  assert.ok(lstatSync(antiga).isSymbolicLink(), 'a antiga virou link');
});

test('quem grava pelo caminho antigo, depois da migração, grava na pasta nova', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{}');
  migrarPastaAntiga(antiga, nova);

  writeFileSync(join(antiga, 'itens', 'proj', 'F2.json'), '{"id":"F2"}');

  assert.equal(readFileSync(join(nova, 'itens', 'proj', 'F2.json'), 'utf8'), '{"id":"F2"}');
});

test('mescla com a pasta nova que já existe: a pasta dos dois lados junta, o arquivo dos dois lados fica o mais novo', () => {
  escrever(join(antiga, 'itens', 'proj', 'F1.json'), '{"id":"F1"}');
  escrever(join(antiga, 'sessoes-do-app.json'), '{"velho":true}');
  escrever(join(antiga, 'tema.json'), '{"tema":"claro"}');
  escrever(join(nova, 'itens', 'proj', 'F2.json'), '{"id":"F2"}');
  escrever(join(nova, 'sessoes-do-app.json'), '{"novo":true}');
  escrever(join(nova, 'tema.json'), '{"tema":"escuro"}');
  const ontem = new Date(Date.now() - 86_400_000);
  utimesSync(join(antiga, 'sessoes-do-app.json'), ontem, ontem); // a barra nova gravou depois
  utimesSync(join(nova, 'tema.json'), ontem, ontem); // o tema da antiga é o mais novo

  assert.equal(migrarPastaAntiga(antiga, nova), 'migrada');

  assert.deepEqual(readdirSync(join(nova, 'itens', 'proj')).sort(), ['F1.json', 'F2.json']);
  assert.equal(readFileSync(join(nova, 'sessoes-do-app.json'), 'utf8'), '{"novo":true}');
  assert.equal(readFileSync(join(nova, 'tema.json'), 'utf8'), '{"tema":"claro"}');
  assert.ok(lstatSync(antiga).isSymbolicLink());
});

test('sem pasta antiga, ou já migrada, não faz nada', () => {
  assert.equal(migrarPastaAntiga(antiga, nova), 'sem-antiga');
  assert.equal(existsSync(nova), false, 'não cria a nova à toa');

  escrever(join(antiga, 'tema.json'), '{}');
  migrarPastaAntiga(antiga, nova);
  assert.equal(migrarPastaAntiga(antiga, nova), 'ja-migrada');
});

test('raiz() migra a pasta antiga da casa quando não há MATHEUS_PLUGINS_HOME', () => {
  for (const nome of ['MATHEUS_PLUGINS_HOME', 'HOME', 'USERPROFILE']) guardado[nome] = process.env[nome];
  delete process.env.MATHEUS_PLUGINS_HOME;
  process.env.HOME = casa;
  process.env.USERPROFILE = casa;
  escrever(join(antiga, 'ausente.json'), '{"ligado":true}');

  assert.equal(raiz(), nova);

  assert.equal(readFileSync(join(nova, 'ausente.json'), 'utf8'), '{"ligado":true}');
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

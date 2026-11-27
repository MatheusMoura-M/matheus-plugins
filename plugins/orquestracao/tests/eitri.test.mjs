// O resumo diário de erros da Eitri: a tarefa agendada grava `eitri-erros.json` pelo `perguntas eitri gravar`, e o Painel mostra.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARQUIVO_EITRI, compararVersoes, gravarRelatorioEitri, lerRelatorioEitri, validarRelatorio } from '../lib/eitri.mjs';
import { main } from '../lib/cli.mjs';
import { html } from '../lib/pagina.mjs';

const AGORA = Date.parse('2026-11-27T09:00:00-03:00');
const raiz = () => process.env.MATHEUS_PLUGINS_HOME;
let saida;
const rodar = (...args) => { saida = []; return main(args, (s) => saida.push(s)); };

beforeEach(() => { process.env.MATHEUS_PLUGINS_HOME = mkdtempSync(join(tmpdir(), 'kit-eitri-')); });

const loja = (extra = {}) => ({
  organizacao: 'Wicomm', aplicativo: 'eitri-shopping-shoulder', eitriApp: 'eitri-shopping-wake-shoulder-home',
  erros: 4, hoje: 1, crashes: 0, resumo: 'React #310: hook chamado dentro de condição', desde: '2026-11-23',
  ultimoEm: '2026-11-26T23:56:16Z', versao: '0.5.71', tendencia: 'subindo', ...extra,
});
const relatorio = (extra = {}) => ({ geradoEm: '2026-11-27T08:05:00-03:00', de: '2026-11-21', ate: '2026-11-27', verificados: 31, lojas: [loja()], falhas: [], ...extra });

test('validar aceita o relatório, ordena as lojas pelo número de erros e recusa campo errado dizendo qual', () => {
  const { relatorio: r, problemas } = validarRelatorio(relatorio({ lojas: [loja({ aplicativo: 'a', erros: 1 }), loja({ aplicativo: 'b', erros: 9 })] }));
  assert.deepEqual(problemas, []);
  assert.deepEqual(r.lojas.map((l) => l.aplicativo), ['b', 'a']);
  const ruim = validarRelatorio(relatorio({ lojas: [loja({ organizacao: '' }), loja({ erros: -1 }), loja({ desde: '23/11' }), loja({ tendencia: 'lado' }), loja({ hoje: 1.5 })] }));
  assert.equal(ruim.relatorio.lojas.length, 0);
  assert.equal(ruim.problemas.length, 5);
  assert.match(ruim.problemas.join('\n'), /hoje/);
  assert.match(ruim.problemas.join('\n'), /organizacao/);
  assert.match(ruim.problemas.join('\n'), /erros/);
  assert.match(ruim.problemas.join('\n'), /desde/);
  assert.match(ruim.problemas.join('\n'), /tendencia/);
  assert.match(validarRelatorio({ lojas: [] }).problemas.join('\n'), /geradoEm/);
  assert.match(validarRelatorio({ geradoEm: '2026-11-27T08:00:00Z', de: '2026-11-21', lojas: [] }).problemas.join('\n'), /ate/);
});

test('o relatório antigo, de um dia só (`dia`), vale como janela daquele dia', () => {
  const { relatorio: r, problemas } = validarRelatorio({ geradoEm: '2026-11-27T08:00:00-03:00', dia: '2026-11-26', lojas: [] });
  assert.deepEqual(problemas, []);
  assert.equal(r.de, '2026-11-26');
  assert.equal(r.ate, '2026-11-26');
});

test('os campos opcionais podem faltar e saem como null', () => {
  const { relatorio: r, problemas } = validarRelatorio(relatorio({ lojas: [{ organizacao: 'Mobfiq', aplicativo: 'eitri-shopping-peahi', erros: 2, resumo: 'falha' }] }));
  assert.deepEqual(problemas, []);
  assert.deepEqual(r.lojas[0], { organizacao: 'Mobfiq', aplicativo: 'eitri-shopping-peahi', eitriApp: null, erros: 2, hoje: null, crashes: null, resumo: 'falha', desde: null, ultimoEm: null, versao: null, tendencia: null, versoes: [] });
});

test('gravar recusa relatório com problema e não deixa arquivo; válido, grava sem temporário', () => {
  assert.throws(() => gravarRelatorioEitri(raiz(), relatorio({ lojas: [loja({ erros: 'muitos' })] })), /erros/);
  assert.equal(existsSync(join(raiz(), ARQUIVO_EITRI)), false);
  gravarRelatorioEitri(raiz(), relatorio());
  assert.deepEqual(readdirSync(raiz()), [ARQUIVO_EITRI]);
  assert.equal(JSON.parse(readFileSync(join(raiz(), ARQUIVO_EITRI), 'utf8')).lojas[0].organizacao, 'Wicomm');
});

test('ler: sem arquivo, ilegível, e loja ruim descartada sem derrubar o resto', () => {
  assert.deepEqual(lerRelatorioEitri(raiz()), { relatorio: null, erro: 'sem-arquivo' });
  writeFileSync(join(raiz(), ARQUIVO_EITRI), 'não é json');
  assert.deepEqual(lerRelatorioEitri(raiz()), { relatorio: null, erro: 'ilegivel' });
  writeFileSync(join(raiz(), ARQUIVO_EITRI), JSON.stringify(relatorio({ lojas: [loja(), { organizacao: 'x' }] })));
  const lido = lerRelatorioEitri(raiz());
  assert.equal(lido.erro, null);
  assert.equal(lido.relatorio.lojas.length, 1);
});

test('perguntas eitri gravar lê o arquivo, grava e diz quantas lojas têm erro', async () => {
  const fonte = join(raiz(), 'entrada.json');
  writeFileSync(fonte, JSON.stringify(relatorio()));
  assert.equal(await rodar('eitri', 'gravar', fonte), 0);
  assert.match(saida.join('\n'), /1 loja com erro de 2026-11-21 a 2026-11-27/);
  assert.ok(existsSync(join(raiz(), ARQUIVO_EITRI)));
  writeFileSync(fonte, JSON.stringify(relatorio({ lojas: [loja({ erros: -2 })] })));
  await assert.rejects(rodar('eitri', 'gravar', fonte), /erros/);
});

test('o Painel só mostra a seção de erros quando há relatório', () => {
  assert.doesNotMatch(html(AGORA), /h-eitri/);
});

test('o Painel mostra loja, erro resumido (escapado), desde quando, os de hoje e a janela do relatório', () => {
  gravarRelatorioEitri(raiz(), relatorio({ lojas: [loja({ resumo: '<b>quebra</b> no carrinho' })] }));
  const h = html(AGORA);
  assert.match(h, /id="h-eitri">Erros Eitri</);
  assert.match(h, /21\/11 a 27\/11/);
  assert.match(h, /<dt>Hoje<\/dt><dd>1<\/dd>/);
  assert.match(h, /Wicomm/);
  assert.match(h, /eitri-shopping-shoulder/);
  assert.match(h, /&lt;b&gt;quebra&lt;\/b&gt; no carrinho/);
  assert.ok(!h.includes('<b>quebra</b>'));
  assert.match(h, /4 erros em 7 dias/);
  assert.match(h, /id="eitri-wicomm-eitri-shopping-shoulder-eitri-shopping-wake-shoulder-home"/, 'o id guarda letras e dígitos');
  assert.match(h, /23\/11\/2026 \(há 4 dias\)/);
  assert.match(h, /subindo/);
});

test('o Painel diz quando ninguém teve erro, quando a org falhou e quando o relatório ficou velho', () => {
  gravarRelatorioEitri(raiz(), relatorio({ lojas: [], falhas: ['Rosset: conexão recusada'] }));
  let h = html(AGORA);
  assert.match(h, /Nenhum erro de 21\/11 a 27\/11 nos 31 apps verificados/);
  assert.match(h, /Não verificado: Rosset: conexão recusada/);
  gravarRelatorioEitri(raiz(), relatorio({ geradoEm: '2026-11-24T08:05:00-03:00', de: '2026-11-18', ate: '2026-11-24', lojas: [] }));
  h = html(AGORA);
  assert.match(h, /relatório velho/);
});

const versao = (erro, prod = '0.5.95', dev = '0.5.95', eitriApp = 'eitri-shopping-wake-shoulder-home') => ({ eitriApp, erro, prod, dev });

test('versoes: valida cada Eitri-app e recusa a lista que não é lista', () => {
  const ok = validarRelatorio(relatorio({ lojas: [loja({ versoes: [versao('0.5.71'), { eitriApp: 'eitri-shopping-pdp' }] })] }));
  assert.deepEqual(ok.problemas, []);
  assert.deepEqual(ok.relatorio.lojas[0].versoes[1], { eitriApp: 'eitri-shopping-pdp', erro: null, prod: null, dev: null });
  assert.match(validarRelatorio(relatorio({ lojas: [loja({ versoes: 'x' })] })).problemas.join('\n'), /versoes/);
  assert.match(validarRelatorio(relatorio({ lojas: [loja({ versoes: [{ erro: '1.0.0' }] })] })).problemas.join('\n'), /versoes\[0\]\.eitriApp/);
  assert.deepEqual(validarRelatorio(relatorio()).relatorio.lojas[0].versoes, []);
});

test('o cartão compara a versão do erro com a de prod e a de dev', () => {
  gravarRelatorioEitri(raiz(), relatorio({ lojas: [loja({ versoes: [versao('0.5.71')] })] }));
  let h = html(AGORA);
  assert.match(h, /<dt>Versões<\/dt>/);
  assert.match(h, /erro 0\.5\.71 · prod 0\.5\.95 · dev 0\.5\.95/);
  assert.match(h, /class="selo selo-versao-antiga">versão antiga</, 'erro só em versão anterior à de prod');
  gravarRelatorioEitri(raiz(), relatorio({ lojas: [loja({ versoes: [versao('0.5.95')] })] }));
  h = html(AGORA);
  assert.match(h, /class="selo selo-versao-prod">na versão de prod</);
  gravarRelatorioEitri(raiz(), relatorio({ lojas: [loja({ versoes: [versao('0.5.10'), versao('0.5.95', '0.5.95', '0.5.95', 'eitri-shopping-pdp')] })] }));
  h = html(AGORA);
  assert.match(h, /selo-versao-prod/, 'basta um Eitri-app na versão de prod');
  assert.doesNotMatch(h, /selo-versao-antiga/);
  gravarRelatorioEitri(raiz(), relatorio({ lojas: [loja({ versoes: [versao('0.5.71', null, null)] })] }));
  h = html(AGORA);
  assert.doesNotMatch(h, /selo-versao-/, 'sem a versão de prod, não julga');
  assert.match(h, /erro 0\.5\.71/);
});

test('compararVersoes: por partes numéricas; texto que não é versão não compara', () => {
  assert.equal(compararVersoes('0.5.71', '0.5.95'), -1);
  assert.equal(compararVersoes('0.10.0', '0.9.9'), 1);
  assert.equal(compararVersoes('1.2', '1.2.0'), 0);
  assert.equal(compararVersoes('beta', '1.0.0'), null);
});

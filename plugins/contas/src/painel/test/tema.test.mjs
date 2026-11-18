// A pasta do kit é ~/.claude/matheus-plugins; antes da migração (que é do orquestracao), a escolha ainda pode estar na
// pasta do kit original, ~/.claude/ichikawa. O painel lê dela de reserva e grava só na nova.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gravarTema, lerTema, lerTemaDoApp, lerTemaDoPainel } from '../tema.mjs';

const casa = () => {
  const home = mkdtempSync(join(tmpdir(), 'tema-'));
  return { home, env: { HOME: home }, antiga: join(home, '.claude', 'ichikawa'), nova: join(home, '.claude', 'matheus-plugins') };
};
const escrever = (pasta, nome, texto) => { mkdirSync(pasta, { recursive: true }); writeFileSync(join(pasta, nome), texto); };

test('sem o arquivo na pasta nova, lê o da pasta do kit original', async () => {
  const c = casa();
  escrever(c.antiga, 'tema.json', '{"tema":"claro"}');
  escrever(c.antiga, 'tema-do-app.json', '{"ligado":false}');
  escrever(c.antiga, 'tema-do-painel.json', '{"ligado":false}');

  assert.equal(await lerTema(c.env), 'claro');
  assert.equal(await lerTemaDoApp(c.env), false);
  assert.equal(await lerTemaDoPainel(c.env), false);
});

test('a pasta nova vence a antiga, e a gravação vai só para a nova', async () => {
  const c = casa();
  escrever(c.antiga, 'tema.json', '{"tema":"claro"}');
  escrever(c.nova, 'tema.json', '{"tema":"escuro"}');
  assert.equal(await lerTema(c.env), 'escuro');

  await gravarTema(c.env, 'claro');

  assert.equal(JSON.parse(readFileSync(join(c.nova, 'tema.json'), 'utf8')).tema, 'claro');
  assert.equal(readFileSync(join(c.antiga, 'tema.json'), 'utf8'), '{"tema":"claro"}');
});

test('com MATHEUS_PLUGINS_HOME, não lê a pasta antiga', async () => {
  const c = casa();
  escrever(c.antiga, 'tema.json', '{"tema":"claro"}');

  assert.equal(await lerTema({ ...c.env, MATHEUS_PLUGINS_HOME: join(c.home, 'teste') }), 'escuro');
});

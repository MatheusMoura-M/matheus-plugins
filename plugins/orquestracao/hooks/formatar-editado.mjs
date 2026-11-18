#!/usr/bin/env node
// PostToolUse (Edit|Write|MultiEdit): formata SÓ o arquivo editado, e só quando o projeto declara formatador
// (biome.json(c) ou .prettierrc*/prettier.config.*). Usa o binário local de node_modules/.bin, nunca `npx` (que baixaria).
// Timeout de 10 s e silêncio em qualquer erro. Desligue com ICHIKAWA_FORMATAR=0.
// Troca o hook de Stop do ECC (stop-format-typecheck, MIT, affaan-m/ECC 2.2.3), que rodava formatador e tsc no fim de todo turno.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { caminhoDe, lerEntrada, rodar } from './comum.mjs';

const TEMPO_MAXIMO_MS = 10_000;
const BIOME = /\.(?:[cm]?[jt]sx?|jsonc?|css)$/;
const PRETTIER = /\.(?:[cm]?[jt]sx?|jsonc?|css|scss|less|html|md|mdx|ya?ml|vue)$/;
const CONFIG_BIOME = /^biome\.jsonc?$/;
const CONFIG_PRETTIER = /^(?:\.prettierrc(?:\..+)?|prettier\.config\..+)$/;

/** Sobe a partir da pasta do arquivo até achar a configuração; devolve { ferramenta, raiz } ou null. */
function acharConfig(arquivo) {
  for (let pasta = dirname(arquivo); ; pasta = dirname(pasta)) {
    let nomes = [];
    try { nomes = readdirSync(pasta); } catch { /* pasta ilegível: segue subindo */ }
    if (nomes.some((n) => CONFIG_BIOME.test(n))) return { ferramenta: 'biome', raiz: pasta };
    if (nomes.some((n) => CONFIG_PRETTIER.test(n))) return { ferramenta: 'prettier', raiz: pasta };
    if (dirname(pasta) === pasta || nomes.includes('.git')) return null;
  }
}

// No Windows o npm põe em .bin um .cmd e um script sh, e o Node não executa nenhum dos dois sem shell (EINVAL/ENOENT).
// Sem abrir shell (o caminho do arquivo vem da ferramenta): roda o script JS do próprio pacote com o node.
const SCRIPT_NO_PACOTE = { biome: join('@biomejs', 'biome', 'bin', 'biome'), prettier: join('prettier', 'bin', 'prettier.cjs') };

function acharBinario(raiz, ferramenta, plataforma) {
  for (let pasta = raiz; ; pasta = dirname(pasta)) {
    const modulos = join(pasta, 'node_modules');
    if (plataforma === 'win32') {
      const script = join(modulos, SCRIPT_NO_PACOTE[ferramenta]);
      if (existsSync(script)) return { bin: process.execPath, prefixo: [script] };
    } else {
      const bin = join(modulos, '.bin', ferramenta);
      if (existsSync(bin)) return { bin, prefixo: [] };
    }
    if (dirname(pasta) === pasta) return null;
  }
}

/** O comando que formata o arquivo editado, ou null quando não há o que fazer. */
export function plano(entrada, ambiente = process.env, plataforma = process.platform) {
  if (ambiente.ICHIKAWA_FORMATAR === '0') return null;
  const arquivo = caminhoDe(entrada);
  if (!arquivo || /[\\/]node_modules[\\/]/.test(arquivo) || !existsSync(arquivo)) return null;
  const config = acharConfig(arquivo);
  if (!config) return null;
  if (!(config.ferramenta === 'biome' ? BIOME : PRETTIER).test(arquivo)) return null;
  const achado = acharBinario(config.raiz, config.ferramenta, plataforma);
  if (!achado) return null;
  const alvo = relative(config.raiz, arquivo);
  const args = config.ferramenta === 'biome' ? ['format', '--write', alvo] : ['--write', alvo];
  return { bin: achado.bin, args: [...achado.prefixo, ...args], cwd: config.raiz };
}

export function formatar(entrada, ambiente = process.env, plataforma = process.platform) {
  const p = plano(entrada, ambiente, plataforma);
  if (!p) return false;
  const r = spawnSync(p.bin, p.args, { cwd: p.cwd, timeout: TEMPO_MAXIMO_MS, stdio: 'ignore' });
  return r.status === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  rodar('formatar-editado', () => { formatar(lerEntrada()); });
}

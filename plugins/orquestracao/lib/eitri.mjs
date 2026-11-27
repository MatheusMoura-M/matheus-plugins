// O resumo diário de erros da Eitri (docs/contratos.md, `eitri-erros.json`). Quem lê a Eitri é a tarefa agendada das 8h,
// pelo MCP (o Painel não tem acesso a ele); ela grava pelo `perguntas eitri gravar`, que valida aqui, e o Painel lê pelo mesmo filtro.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ARQUIVO_EITRI = 'eitri-erros.json';
/** Relatório gerado há mais que isto: a tarefa das 8h não rodou hoje (um dia e uma folga). */
export const RELATORIO_VELHO_MS = 30 * 60 * 60 * 1000;
export const TENDENCIAS = ['novo', 'subindo', 'caindo', 'estavel'];

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const inteiro = (v) => Number.isInteger(v) && v >= 0;
const isoValido = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** Uma loja: `{ loja }` normalizada ou `{ problema }` dizendo o campo. */
function lojaLida(o, n) {
  const onde = `lojas[${n}]`;
  if (!o || typeof o !== 'object') return { problema: `${onde}: não é objeto` };
  if (!texto(o.organizacao)) return { problema: `${onde}.organizacao: texto obrigatório` };
  if (!texto(o.aplicativo)) return { problema: `${onde}.aplicativo: texto obrigatório` };
  if (!inteiro(o.erros)) return { problema: `${onde}.erros: inteiro de 0 para cima` };
  if (o.hoje != null && !inteiro(o.hoje)) return { problema: `${onde}.hoje: inteiro de 0 para cima` };
  if (!texto(o.resumo)) return { problema: `${onde}.resumo: texto obrigatório` };
  if (o.crashes != null && !inteiro(o.crashes)) return { problema: `${onde}.crashes: inteiro de 0 para cima` };
  if (o.desde != null && !DIA.test(String(o.desde))) return { problema: `${onde}.desde: AAAA-MM-DD` };
  if (o.ultimoEm != null && !isoValido(o.ultimoEm)) return { problema: `${onde}.ultimoEm: data ISO-8601` };
  if (o.tendencia != null && !TENDENCIAS.includes(o.tendencia)) return { problema: `${onde}.tendencia: ${TENDENCIAS.join(', ')}` };
  return {
    loja: {
      organizacao: texto(o.organizacao), aplicativo: texto(o.aplicativo), eitriApp: texto(o.eitriApp),
      erros: o.erros, hoje: o.hoje ?? null, crashes: o.crashes ?? null, resumo: texto(o.resumo), desde: o.desde ?? null,
      ultimoEm: o.ultimoEm ?? null, versao: texto(o.versao), tendencia: o.tendencia ?? null,
    },
  };
}

/**
 * O relatório sem confiar em quem gravou: `{ relatorio, problemas }`. A janela vai de `de` a `ate` (hoje, na tarefa
 * das 8h); o relatório antigo, de um dia só (`dia`), vale como janela daquele dia. Sem `geradoEm` ou sem a janela,
 * `relatorio` é `null`; loja com problema fica de fora (e entra em `problemas`). As lojas saem da que tem mais erros
 * para a que tem menos.
 */
export function validarRelatorio(bruto) {
  if (!bruto || typeof bruto !== 'object') return { relatorio: null, problemas: ['o relatório não é objeto'] };
  const problemas = [];
  const de = bruto.de ?? bruto.dia;
  const ate = bruto.ate ?? bruto.dia;
  if (!isoValido(bruto.geradoEm)) problemas.push('geradoEm: data ISO-8601 obrigatória');
  if (!DIA.test(String(de ?? ''))) problemas.push('de: AAAA-MM-DD obrigatório (o primeiro dia da janela)');
  if (!DIA.test(String(ate ?? ''))) problemas.push('ate: AAAA-MM-DD obrigatório (o último dia da janela, hoje)');
  else if (DIA.test(String(de ?? '')) && de > ate) problemas.push('de: não pode vir depois de ate');
  if (!Array.isArray(bruto.lojas)) problemas.push('lojas: lista obrigatória (vazia quando ninguém teve erro)');
  if (problemas.length) return { relatorio: null, problemas };
  const lojas = [];
  bruto.lojas.forEach((o, n) => {
    const r = lojaLida(o, n);
    if (r.problema) problemas.push(r.problema); else lojas.push(r.loja);
  });
  lojas.sort((a, b) => b.erros - a.erros || a.organizacao.localeCompare(b.organizacao) || a.aplicativo.localeCompare(b.aplicativo));
  const falhas = Array.isArray(bruto.falhas) ? bruto.falhas.map(texto).filter(Boolean) : [];
  const verificados = inteiro(bruto.verificados) ? bruto.verificados : null;
  return { relatorio: { geradoEm: bruto.geradoEm, de, ate, verificados, lojas, falhas }, problemas };
}

/** Grava o relatório validado (escreve ao lado e renomeia). Com qualquer problema, recusa e não toca no arquivo. */
export function gravarRelatorioEitri(raiz, bruto) {
  const { relatorio, problemas } = validarRelatorio(bruto);
  if (problemas.length) throw new Error(`relatório recusado:\n  ${problemas.join('\n  ')}`);
  mkdirSync(raiz, { recursive: true });
  const caminho = join(raiz, ARQUIVO_EITRI);
  const temp = `${caminho}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(relatorio, null, 2)}\n`);
  renameSync(temp, caminho);
  return relatorio;
}

/** O que o Painel mostra: `{ relatorio, erro }`, com `erro` igual a `sem-arquivo` ou `ilegivel`. */
export function lerRelatorioEitri(raiz) {
  let bruto;
  try { bruto = JSON.parse(readFileSync(join(raiz, ARQUIVO_EITRI), 'utf8')); } catch (err) {
    return { relatorio: null, erro: err?.code === 'ENOENT' ? 'sem-arquivo' : 'ilegivel' };
  }
  const { relatorio } = validarRelatorio(bruto);
  return relatorio ? { relatorio, erro: null } : { relatorio: null, erro: 'ilegivel' };
}

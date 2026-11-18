// Preload (`node --import`) do processo que o WMI cria no Windows (`soltarPeloWmi` em windows.mjs). Esse processo nasce
// sem o ambiente de quem pediu e sem saída padrão: aqui ele tira o `--pedido-solto <arquivo>` do argv, lê e apaga o
// pedido, deixa as variáveis de `VARIAVEIS_DO_SOLTO` iguais às de quem pediu e manda o stdout e o stderr ao log.
import { openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { VARIAVEIS_DO_SOLTO } from './windows.mjs';

const i = process.argv.indexOf('--pedido-solto');
if (i >= 2 && i + 1 < process.argv.length) {
  const arquivo = process.argv[i + 1];
  process.argv.splice(i, 2);
  let pedido = {};
  try { pedido = JSON.parse(readFileSync(arquivo, 'utf8')) ?? {}; } catch { /* sem pedido: segue com o ambiente do WMI */ }
  try { rmSync(arquivo, { force: true }); } catch { /* fica para a próxima limpeza */ }
  const variaveis = pedido.variaveis && typeof pedido.variaveis === 'object' ? pedido.variaveis : {};
  for (const k of VARIAVEIS_DO_SOLTO) {
    if (typeof variaveis[k] === 'string') process.env[k] = variaveis[k];
    else delete process.env[k];
  }
  if (typeof pedido.log === 'string' && pedido.log) {
    try {
      const fd = openSync(pedido.log, 'a', 0o600);
      const escrever = (dado, codificacao, feito) => {
        try { writeSync(fd, typeof dado === 'string' ? dado : Buffer.from(dado)); } catch { /* log cheio ou fechado: a troca segue */ }
        const cb = typeof codificacao === 'function' ? codificacao : feito;
        if (typeof cb === 'function') cb();
        return true;
      };
      process.stdout.write = escrever;
      process.stderr.write = escrever;
      // O erro fatal o Node escreve direto no fd 2, que aqui não existe: vai ao log antes de sair.
      const fatal = (e) => { escrever(`erro fatal: ${e?.stack ?? e}\n`); process.exit(1); };
      process.on('uncaughtException', fatal);
      process.on('unhandledRejection', fatal);
    } catch { /* sem log: a saída se perde, a troca segue */ }
  }
}

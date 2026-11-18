# Pasta de estado `~/.claude/matheus-plugins` (MAT-F3)

Pedido: tirar a marca do autor antigo do que é identidade do kit, sem apagar o crédito da licença. Este plano cobre a parte de contrato (MAT-Q2, respondida pelo operador: "Sim, siga a recomendação"); autor e assinatura esperam o MAT-Q3, o ateliê o MAT-Q4.

Pronto: os três plugins que usam a pasta (orquestracao, barra, contas) gravam em `~/.claude/matheus-plugins`, o que estava em `~/.claude/ichikawa` chega lá sem perda, sessões que ainda rodam a versão velha continuam gravando no mesmo lugar, e o gate do `CLAUDE.md` passa.

## Contrato novo

- Pasta: `~/.claude/matheus-plugins/` (`$MATHEUS_PLUGINS_HOME` sobrescreve, para teste).
- Variáveis: `ICHIKAWA_HOME` → `MATHEUS_PLUGINS_HOME`, `ICHIKAWA_FORMATAR` → `MATHEUS_PLUGINS_FORMATAR`, `ICHIKAWA_SEM_NAVEGADOR` → `MATHEUS_PLUGINS_SEM_NAVEGADOR`. As antigas deixam de valer (a máquina do operador não define nenhuma).

## Tarefas

1. **orquestracao — migração** (Risco: sim, mexe em dado vivo). `estado.migrarPastaAntiga(antiga, nova)`:
   - `antiga` não existe, ou já é link: nada.
   - Senão, move cada entrada para `nova` (cria a pasta); pasta que existe dos dois lados é mesclada; arquivo que existe dos dois lados: o de `mtime` maior vence, o outro sai.
   - Erro numa entrada (arquivo preso no Windows) não para as outras; o que sobrou fica para a próxima vez.
   - Com a antiga vazia, apaga e cria no lugar um link para a nova (`junction` no Windows, que não pede administrador). Sessões abertas antes do release, na versão velha, gravam pelo link na pasta nova.
   - `raiz()` chama a migração uma vez por processo, só quando não há `MATHEUS_PLUGINS_HOME`. Cobre hooks, CLI e Painel.
2. **barra** (Risco: não). `pastaDoKit` com `MATHEUS_PLUGINS_HOME`; as leituras (`ausente.json`, `tema.json`, `tema-do-app.json`) caem para a pasta antiga quando o arquivo ainda não está na nova (barra sem o orquestracao, ou antes da primeira migração). A barra não migra: o `$.fs` dela não renomeia.
3. **contas** (Risco: não). `tema.mjs`: mesma pasta e a mesma leitura de reserva.
4. **Variáveis e testes** (Risco: não): `formatar-editado.mjs`, `pagina.mjs`, testes dos três plugins, fixtures `@ichikawa`/`ichikawa-plugins` → `matheus-plugins`.
5. **Docs** (Risco: não): `docs/contratos.md`, `README.md`, `plugins/barra/README.md`, `CLAUDE.md`. Os planos antigos em `docs/planos/` ficam como estão (são histórico).

## Testes

- `migrarPastaAntiga`: move tudo e deixa o link; mescla com a pasta nova que a barra já criou; arquivo dos dois lados fica o mais novo; link já feito não faz nada; sem pasta antiga não faz nada; gravar pelo link cai na nova.
- `raiz()` com `MATHEUS_PLUGINS_HOME` não migra.
- barra e contas: leitura de reserva da pasta antiga, gravação só na nova.

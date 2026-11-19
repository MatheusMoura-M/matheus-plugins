# MAT-F7 · Pergunta da orquestradora sempre ligada à sessão

Data: 2026-11-19

## Pedido e causa medida

A pergunta que a orquestradora grava no painel tem que sair ligada à sessão dela. Só assim a resposta dada pelo painel chega até ela.

Causa (medida no wicomm-wake-shopping, WIC-Q6 e WIC-Q10): `perguntas nova` grava `sessao = --sessao ?? sessão do item ?? null`. A orquestradora pergunta com `--item` de item ainda sem dona, a pergunta sai com `sessao: null`, a página só grava o pedido de entrega para `local_…` e a resposta fica parada até o operador cobrar no chat. Com `--sessao local_…` (WIC-Q11, Q12, Q14) a resposta chegou sozinha.

## Pronto quando

- A skill `orquestradora` manda `--sessao <local_… da própria sessão>` em toda pergunta, com o id vindo do `get_session` com `"self"`.
- O kit recusa a pergunta da orquestradora sem `--sessao local_…`.
- A skill registra o limite do app: o turno aberto pela resposta do painel conta como automático.
- Teste cobrindo a regra; testes afetados passando.

## Decisão: hook, não CLI

Recusa no hook `PreToolUse` do Bash e do PowerShell (`pergunta-com-sessao`), só na sessão com o papel orquestradora:

1. O hook sabe quem chama: o `session_id` vem na entrada e o papel no marcador (`papelDe`), como em `pergunta-na-caixa` e `orquestradora-nao-edita`. O CLI só saberia por `CLAUDE_CODE_SESSION_ID`, variável que o app não documenta e que pode ficar com o id velho depois do `/clear` (a orquestradora se limpa sempre).
2. Recusar antes de rodar não deixa pergunta gravada com `sessao: null`. Não há comando para trocar a sessão depois: seria descartar e gravar de novo.
3. Recusar no CLI para todo mundo travaria sessão de terminal, que não tem `local_…`. A dona já tem a sessão no item (passo 1 da skill dela).

O hook exige `--sessao` explícito, mesmo com `--item` de item com dona: sem ele, a pergunta da orquestradora iria para a dona.

Limite aceito: o hook lê o texto do comando. `perguntas nova` montado por variável ou por `node …/cli.mjs` passa sem conferência. É uma trava contra o esquecimento, não contra quem quer contornar.

## Tarefas

1. `hooks/pergunta-com-sessao.mjs` + entrada no `hooks.json` (matcher `Bash|PowerShell`). Risco: não.
2. As cobranças de `pergunta-na-caixa` e `pergunta-no-painel` mostram o `--sessao` à orquestradora (senão ensinam um comando que o hook novo recusa). Risco: não.
3. Teste em `tests/orquestracao.test.mjs` (antes do código). Risco: não.
4. Skill `orquestradora`: `get_session` `"self"` ao assumir, `--sessao` em toda pergunta, o limite do app. `regras.md`, `README.md` e `docs/contratos.md`. Risco: não.

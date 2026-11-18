# contas

Painel local para quem usa várias contas no app desktop do Claude, no macOS e no Windows:

- **Cota de cada conta**: as janelas de 5 h e da semana, lado a lado, com a hora em que cada uma zera. A barra vai do verde (livre) ao vermelho (perto do limite).
- **Ordem da lista**: a conta no app primeiro; as outras pela cota livre na semana, da mais livre para a menos.
- **Troca de conta sem Sign out** e sem código por e-mail a cada troca.
- **As sessões do Code continuam na conta nova**: a lista de conversas vem junto, e as que estavam respondendo quando o app fechou são retomadas sozinhas.
- **Sessões ativas**: as conversas do Code mexidas nas últimas 24 h, com as que estão respondendo agora em destaque.

Tudo roda em `127.0.0.1`, sem dependência npm (Node ≥ 20, só módulos nativos).

## Instalar

```bash
claude plugin marketplace add MatheusMoura-M/matheus-plugins
claude plugin install contas@matheus-plugins
```

Com o plugin `barra` ligado, o botão **Contas** abre o painel. Sem o plugin, de dentro desta pasta: `node src/painel/cli.mjs` e `node src/troca/cli.mjs` (ou `npm link` para ter `painel-de-contas` e `trocar-conta` no PATH).

## Usar

```bash
painel-de-contas            # sobe o painel em http://127.0.0.1:4791 e abre o navegador
```

| No painel | O que faz |
|---|---|
| **Ler cota** | No Mac, pede uma vez ao macOS a senha "Claude Safe Storage" do Keychain (clique em **Permitir**, não em Permitir Sempre). No Windows, abre sem perguntar nada a chave que o app guarda na sua conta do Windows (o `Local State` do app, protegido pela DPAPI). Depois lê a cota de todas as contas guardadas. A senha e a chave ficam só na memória do painel. |
| **Adicionar conta** | Guarda a conta aberta, fecha o app e o abre na tela de entrada. Entre com a outra conta (código do e-mail, uma vez por conta); o app volta sozinho para a conta de antes. |
| **Trocar para esta** | Fecha o app, põe o login da conta escolhida, traz a lista de conversas e abre o app de novo (uns 5 s). |
| **Dar nome** | Dá um nome à conta na lista. |
| **Sincronizar lista** | Deixa a lista de conversas da conta aberta igual à das outras contas. |

O mesmo pelo terminal: `trocar-conta --ajuda`.

### Vindo do kit de orquestração

Se o kit já guardou os logins das suas contas, traga-os sem entrar de novo em cada uma:

```bash
trocar-conta importar-do-kit
```

Copia de `~/.claude/orquestracao/troca-de-conta/` os logins, os nomes e a última cota lida. A origem fica como estava. Depois disso as duas instalações seguem separadas: use uma só para trocar de conta, senão o login guardado numa envelhece enquanto a outra troca.

### Como plugin do Claude Code (`contas`)

O repositório também é o plugin `contas`: o botão **Contas** da barra (`barra.json`) roda `node src/painel/abrir.mjs --sem-abrir`, que sobe o painel desacoplado se ele não estiver no ar, e a barra abre a página no navegador do app (`url` no `barra.json`). No terminal, `abrir-painel-de-contas` faz o mesmo e abre o navegador do sistema. A skill `trocar-conta` lista as contas e abre o painel, mas nunca troca de dentro da sessão: a troca fecha o app.

## O que você precisa saber

- **Nunca use Sign out no app para trocar de conta.** Ele invalida o login guardado daquela conta.
- **A troca fecha o app.** No Mac, rode o painel de um terminal, não de dentro do Code do app. No Windows, tudo que o app lança morre quando ele fecha, então o painel lança a troca pelo WMI, fora do app, e o botão **Contas** da barra serve.
- **Todas as sessões do Code abertas no app são cortadas na troca**, e o app retoma as que estavam respondendo.
- **No Windows, com o Claude Account Switcher original (o app) instalado:** ele usa a mesma pasta (`~/.claude-account-switcher/`, com outros nomes de arquivo: `accounts/`, `state.json`). Use um só para trocar de conta, senão o login guardado num envelhece enquanto o outro troca.
- **Login guardado envelhece.** Se o app pedir para entrar de novo depois de trocar, entre com o código do e-mail e use **Adicionar conta** com ela aberta.
- **O app pode mudar o formato dos arquivos** numa atualização. Se o `config.json` não estiver no formato esperado, a troca recusa sem gravar nada.
- **Termos de uso:** ter várias contas não é proibido; usar contas para contornar limite pode ferir as regras do plano. Por isso não há troca automática.

## O que grava e onde

Pasta de dados: `~/.claude-account-switcher/` (troque com `TROCA_DE_CONTA_DIR`). No Mac, pastas `0700` e arquivos `0600`; no Windows a pasta do usuário já é só dele pela permissão do sistema (o Windows não guarda esses modos).

| O quê | Onde |
|---|---|
| Login de cada conta (3 chaves do `config.json` + `Cookies`, cifrados como o app os gravou) | `contas/<conta>/` |
| Nomes das contas (sem token) | `estado.json` |
| Backup do `config.json` e do `Cookies` antes de cada troca (10 últimos) | `backups/<data>/` |
| Última cota lida de cada conta e o e-mail (sem token) | `uso.json` |
| Desfecho da última ação, lido pelo painel | `ultima-acao.json` |
| Conversas tiradas da lista por terem sido apagadas em outra conta | `lista-reserva/` |
| Windows: o pedido de cancelar o "adicionar e voltar" (o pid de quem espera), apagado ao ser lido | `cancelar-adicionar` |
| Windows: o pedido de quem lança a troca ou o painel pelo WMI (as variáveis da troca e o log, sem segredo), apagado ao ser lido | `pedido-<aleatório>.json` |

A lista de conversas fica onde o app a guarda: no Mac, `~/Library/Application Support/Claude/claude-code-sessions/`; no Windows, `%LOCALAPPDATA%\Claude-Data\claude_<pacote>\claude-code-sessions\` (o app da Microsoft Store; a instalação antiga usava `%APPDATA%\Claude`). Troque a pasta do app com `CLAUDE_APP_DIR`. O conteúdo das conversas (`~/.claude/projects`) nunca é tocado.

### No Windows, por dentro

- **O app** é reconhecido pelo caminho do `Claude.exe` do pacote, nunca pelo nome: as sessões do Claude Code também se chamam `claude.exe`.
- **Fechar:** fechar a janela só esconde o app na bandeja. A troca manda às janelas do app o recado de fim de sessão do Windows (o mesmo do Restart Manager), e o app sai limpo; se não sair em 20 s, os processos do app (só eles) são encerrados à força.
- **Abrir:** pelo `shell:AppsFolder` do pacote.
- **A chave dos logins:** `os_crypt.encrypted_key` do `Local State`, aberta pela DPAPI; os logins são AES-256-GCM. Cada chamada ao PowerShell vai por `-EncodedCommand` (a política de execução de scripts não bloqueia) e recebe dado só pelo ambiente do processo filho.
- **Cancelar o "adicionar e voltar":** o painel grava `cancelar-adicionar` e a troca, que confere a cada meio segundo, volta para a conta de antes (no Windows o Node não tem um sinal que o processo possa tratar).

## Desenvolver

```bash
npm test
```

## Créditos

A lógica de troca é um port para Node do [Claude Account Switcher](https://github.com/SnlperStripes/claude-account-switcher) de SnlperStripes (Apache-2.0); veja [`NOTICE`](NOTICE).

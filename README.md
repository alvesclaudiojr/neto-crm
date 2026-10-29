# Consultório — CRM simples

Cadastro de clientes com histórico de contato, catálogo de procedimentos e
orçamentos com impressão/PDF. Roda no navegador, com login por e-mail e senha
e verificação em duas etapas (app autenticador) recomendada.

- **Frontend:** TypeScript + Vite, sem framework, publicado no GitHub Pages.
- **Banco e login:** [Supabase](https://supabase.com) (Postgres + Auth), plano gratuito.

## Segurança: como está montada

| Camada | O que faz |
|---|---|
| Cadastro público desligado | Só o administrador cria usuários, pela tela **Usuários** do app. |
| Gestão de usuários no servidor | Criar, resetar senha e remover passam pela Edge Function `usuarios`, que guarda a chave secreta e confere de novo se quem pede é administrador (e, se ele usa 2FA, se passou pelo código). |
| Senha provisória | Usuário novo (ou com senha resetada) é obrigado a criar a própria senha no primeiro acesso. |
| Tabela `membros` | Ter login não basta: o usuário precisa estar liberado nela. |
| 2FA recomendado | O app sugere ativar o autenticador (Configurações). Quem ativou é obrigado a usar: o **banco** só libera os dados para essa pessoa depois do código (`aal2`), então descobrir a senha não basta. |
| RLS em todas as tabelas | As regras ficam no Postgres. A chave "anon" no site é pública por design e sozinha não lê nada. |
| Sem `innerHTML` | Todo texto digitado é exibido como texto (proteção contra XSS). |
| CSP no build | O navegador só executa scripts do próprio site e só conversa com o Supabase. |
| Saída por inatividade | Sessão encerra após 30 min sem uso. |
| Repositório sem dados | `.env` e backups estão no `.gitignore`. O código pode ser público. |

**O que fica por conta de quem usa:** senha forte e exclusiva, ativar o 2FA, não deixar o PC destravado, e guardar os backups em local seguro.

## Configuração (uma vez)

### 1. Supabase
1. Criar conta e um projeto em https://supabase.com. Em **Region**, escolha **South America (São Paulo)**.
2. **SQL Editor → New query:** cole e rode, **em ordem**, cada arquivo de `supabase/migrations/`
   (`0001_inicial.sql`, `0002_descontos.sql`, …). O aviso de "destructive operation" é esperado
   (vem do `delete` dentro da função de salvar orçamento).
3. **Authentication → Sign In / Providers → Email:** desligue **Allow new users to sign up**.
4. **Authentication → Multi-Factor:** confira se **TOTP** está habilitado (é o padrão).
5. **Authentication → URL Configuration:** em **Site URL** e **Redirect URLs**, coloque o endereço do site
   (ex.: `https://SEU-USUARIO.github.io/neto-crm/`) e, para desenvolvimento, `http://localhost:5173/`.
6. **Edge Functions → Deploy a new function → Via Editor:** nome `usuarios`, cole
   `supabase/functions/usuarios/index.ts` e clique em **Deploy function**
   (ou `supabase functions deploy usuarios` pela CLI).
7. **Primeiro administrador** (só uma vez): em **Authentication → Users → Add user → Create new user**,
   crie o seu login (marque *Auto Confirm User*) e libere no **SQL Editor**:
   ```sql
   insert into public.membros (user_id, nome, admin)
   select id, 'Seu nome', true from auth.users where email = 'seu@email.com';
   ```
   Daqui em diante, os outros dentistas são criados pelo próprio app, em **Usuários**.

### 2. Rodar localmente
```bash
nvm use            # Node 22 (.nvmrc)
npm install
cp .env.example .env   # preencha URL e anon key (Project Settings → API)
npm run dev
```

### 3. Publicar no GitHub Pages
1. Suba o repositório para o GitHub.
2. **Settings → Pages → Source:** GitHub Actions.
3. **Settings → Secrets and variables → Actions → Variables:** crie `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY`.
4. Cada push na `main` publica o site automaticamente.

## Uso no dia a dia
1. Abrir o endereço do site (dá para fixar como app pelo Edge/Chrome: menu → *Instalar*).
2. Entrar com e-mail (ou nome de usuário) e senha, e o código do celular se tiver ativado o 2FA.
3. Antes de tudo, preencher **Configurações → Dados da clínica** (eles saem no orçamento).
4. Cadastrar procedimentos com preço, depois clientes, depois orçamentos.
5. No orçamento, **Imprimir / PDF** abre a folha pronta para imprimir ou salvar como PDF.
6. Periodicamente: **Configurações → Baixar backup**.

## Pontos de atenção
- **Plano gratuito do Supabase:** o projeto é pausado após ~1 semana sem nenhum acesso. É só
  reativar no painel, sem perda de dados. O plano gratuito também não oferece backups para baixar,
  por isso o botão de backup do app.
- **Esqueceu a senha ou perdeu o celular do autenticador:** o administrador usa **Nova senha** ou
  **Zerar autenticador** na tela **Usuários**. No próximo login o app pede para criar a senha ou
  cadastrar o autenticador de novo.
- **LGPD:** são dados pessoais de saúde. Coletar só o necessário (CPF é opcional de propósito),
  e excluir os dados de um paciente se ele pedir.
- **Dois consultórios:** já funciona. É o mesmo site e o mesmo banco, basta entrar de outro PC.

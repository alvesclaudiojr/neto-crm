# Consultório — CRM simples

Cadastro de clientes com histórico de contato, catálogo de procedimentos e
orçamentos com impressão/PDF. Roda no navegador, com login por e-mail e senha
e verificação em duas etapas (app autenticador) obrigatória.

- **Frontend:** TypeScript + Vite, sem framework, publicado no GitHub Pages.
- **Banco e login:** [Supabase](https://supabase.com) (Postgres + Auth), plano gratuito.

## Segurança: como está montada

| Camada | O que faz |
|---|---|
| Cadastro público desligado | Só o administrador cria usuários no painel do Supabase. |
| Tabela `membros` | Ter login não basta: o usuário precisa estar liberado nela. |
| 2FA obrigatório | No primeiro acesso o app exige cadastrar o autenticador. O **banco** só libera os dados para sessões que passaram pelo 2FA (`aal2`), então nem um erro no frontend expõe dados. |
| RLS em todas as tabelas | As regras ficam no Postgres. A chave "anon" no site é pública por design e sozinha não lê nada. |
| Sem `innerHTML` | Todo texto digitado é exibido como texto (proteção contra XSS). |
| CSP no build | O navegador só executa scripts do próprio site e só conversa com o Supabase. |
| Saída por inatividade | Sessão encerra após 30 min sem uso. |
| Repositório sem dados | `.env` e backups estão no `.gitignore`. O código pode ser público. |

**O que fica por conta de quem usa:** senha forte e exclusiva, celular com o
autenticador protegido, não deixar o PC destravado, e guardar os backups em local seguro.

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
6. **Authentication → Users → Add user → Create new user:** e-mail e senha do dentista
   (marque *Auto Confirm User*).
7. Libere esse usuário no **SQL Editor**:
   ```sql
   insert into public.membros (user_id, nome)
   select id, 'Dr. Fulano' from auth.users where email = 'email@do-dentista.com';
   ```

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
2. Entrar com e-mail e senha, e depois o código de 6 dígitos do celular.
3. Antes de tudo, preencher **Configurações → Dados da clínica** (eles saem no orçamento).
4. Cadastrar procedimentos com preço, depois clientes, depois orçamentos.
5. No orçamento, **Imprimir / PDF** abre a folha pronta para imprimir ou salvar como PDF.
6. Periodicamente: **Configurações → Baixar backup**.

## Pontos de atenção
- **Plano gratuito do Supabase:** o projeto é pausado após ~1 semana sem nenhum acesso. É só
  reativar no painel, sem perda de dados. O plano gratuito também não oferece backups para baixar,
  por isso o botão de backup do app.
- **Perdeu o celular do autenticador:** o administrador remove o fator do usuário em
  **Authentication → Users → (usuário) → MFA factors**. No próximo login o app pede para cadastrar de novo.
- **LGPD:** são dados pessoais de saúde. Coletar só o necessário (CPF é opcional de propósito),
  e excluir os dados de um paciente se ele pedir.
- **Dois consultórios:** já funciona. É o mesmo site e o mesmo banco, basta entrar de outro PC.

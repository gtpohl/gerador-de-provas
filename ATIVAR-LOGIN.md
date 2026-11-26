# Ateliê de Provas — conexão Supabase preparada

## O que já está feito

- Projeto “Ateliê de Provas” criado no plano Free, na região de São Paulo.
- Projeto: duzkejrxmbxjezbxwesb.
- Banco e regras de acesso instalados. Não execute novamente o schema incluído: ele é uma cópia de referência do que já foi aplicado.
- Chave publicável e URL preenchidas em `portal-config.js`. Essa chave pode estar no site; ela depende das regras de acesso do banco. Nenhuma chave secreta está neste pacote.
- Esta cópia usa o pacote do site exportado em 25/11, preservando os arquivos da correção por PDF e identificação das folhas. O site atualmente hospedado não foi alterado.

## Próximo passo: criar sua conta de professor

A conta administrativa que você criou para entrar no Supabase é diferente da conta usada no seu site.

1. Abra https://supabase.com/dashboard/project/duzkejrxmbxjezbxwesb/auth/users.
2. Em Authentication / Users, use Add user / Create new user.
3. Cadastre seu e-mail e escolha uma senha individual forte. Se disponível, confirme o e-mail nessa criação administrativa.
4. Avise no ChatGPT qual e-mail cadastrou para que essa conta seja autorizada como professor. Não envie a senha.
5. Para testar a privacidade, crie duas contas de teste de alunos da mesma forma. Não use contas reais de alunos antes dos testes.

O banco está sem contas ou notas reais. Ainda não é possível entrar no portal até existir uma conta cadastrada e autorizada.

## Endereço do site e recuperação de senha

Informe no ChatGPT o endereço final do GitHub Pages. Em Authentication / URL Configuration, configure a Site URL e adicione a URL completa de `aluno.html` em Redirect URLs. O projeto ainda não recebeu esse endereço.

Para recuperação de senha com alunos reais, configure um provedor SMTP. O envio padrão do Supabase é limitado e restringe destinatários; o provedor escolhido pode ter custos próprios. Não há SMTP externo contratado nesta preparação.

## Publicação: pendente de sua aprovação

Os arquivos da raiz deste ZIP são os arquivos do site, prontos para a raiz do repositório no GitHub Pages. As pastas `tests` e `configuracao-supabase` são documentação e testes; podem ficar fora da publicação. Nenhuma publicação foi realizada.

Para o aluno, compartilhe o endereço terminado em `/aluno.html`. Não coloque backups, planilhas ou notas no GitHub. Os dados enviados ficam no Supabase.

## Operação do professor

1. Importe, configure e corrija a avaliação pelos módulos existentes. Salve a avaliação e confirme as correções.
2. Abra “Área do aluno · envio de resultados” e entre com sua conta de professor.
3. Defina um código único, como `quimica-1bim-2026`. Reuse esse código para atualizar a mesma avaliação; use outro para uma nova. Anote o código.
4. Vincule cada RA corrigido ao UUID da conta correspondente (Authentication / Users). Formato: `RA;UUID`, um aluno por linha. Confira os vínculos cuidadosamente antes de liberar.
5. Marque a liberação das notas e, se desejar, das respostas/gabarito. Envie.

O envio substitui os resultados desse professor e código de avaliação de forma atômica. Alunos removidos do conjunto enviado deixam de ter o resultado anterior. Reenviar com a liberação desmarcada oculta os resultados.

## Anulação e recálculo

Use X no gabarito da questão anulada e salve a avaliação. As respostas já confirmadas são mantidas. Depois envie novamente com o mesmo código e os vínculos correspondentes. Não precisa reimportar. Salvar no navegador sozinho não sincroniza a publicação: o envio é manual. O aluno deve recarregar a página e entrar novamente para ver a atualização.

O editor continua guardando a avaliação completa neste navegador: mantenha seu backup. O Supabase recebe apenas as correções confirmadas enviadas pelo novo módulo, não as digitalizações nem o backup completo.

## Verificações realizadas e pendentes

Realizadas: projeto saudável, plano Free confirmado, RLS nas tabelas, bloqueio de leitura anônima e autoautorização de professor, bloqueio de publicação por conta não autorizada. O diagnóstico de segurança não indicou alertas. O índice de consulta do aluno ainda não foi utilizado porque o banco está vazio.

Testes locais: sintaxe dos módulos, cálculo com anulação/pesos/pontos, montagem do envio, liberação de gabarito e bloqueio de vínculos ausentes/duplicados.

Pendentes: login real do professor e de dois alunos; isolamento A/B com notas de teste; atualização após recálculo pelo portal; recuperação de senha e teste visual no navegador. A tentativa de gerar usuários fictícios diretamente em `auth.users` para o teste foi recusada; nenhuma conta de teste foi criada por esse procedimento. Os testes seguintes usarão contas criadas pelo fluxo de Authentication.

As sessões são mantidas apenas na memória da aba; recarregar exige novo login. O projeto gratuito pode pausar por inatividade, conforme as condições do Supabase.

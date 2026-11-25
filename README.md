# Ateliê de Provas

Código completo da versão 9 do Ateliê de Provas, pronto para uma publicação estática no GitHub Pages. O pacote inclui o aplicativo e as bibliotecas locais usadas para Word, Excel, PDF e reconhecimento de texto (OCR). A publicação dispensa instalação de dependências, etapa de build e configuração de servidor.

## Publicar no GitHub Pages

1. Extraia o ZIP. Use um repositório separado, por exemplo, **atelie-de-provas**.
2. Envie **o conteúdo extraído** para a raiz da branch **main** e confirme o commit. Na raiz do repositório, confira se **index.html**, **style.css**, **correction.js** e a pasta **vendor/** aparecem lado a lado. Mantenha os arquivos dentro de **vendor/** nas respectivas subpastas. Se o envio pelo navegador omitir o arquivo vazio **.nojekyll**, crie-o na raiz com **Add file → Create new file**.
3. Em **Settings → Pages**, escolha **Deploy from a branch**. Selecione **main** e **/ (root)** e clique em **Save**.
4. Aguarde a publicação e abra o endereço exibido em **Settings → Pages**. Para o repositório sugerido, o formato será `https://SEU-USUARIO.github.io/atelie-de-provas/`.

[Documentação do GitHub Pages sobre a fonte de publicação](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Transferir uma avaliação

Os arquivos enviados ao aplicativo são processados no navegador. A avaliação salva pertence ao endereço onde foi cadastrada. Para transferir a configuração, a lista de alunos e as correções confirmadas, use **05 Alunos e folhas ópticas → Baixar backup** no site de origem e **Restaurar backup** na cópia do GitHub Pages.

A fila de folhas digitalizadas é temporária. Para retomar uma revisão pendente na cópia, importe novamente o PDF no módulo **06 Correção por PDF**. Guarde os backups e os arquivos com dados dos alunos fora do repositório. O acesso à cópia segue as regras do GitHub Pages, que normalmente publica o site para qualquer pessoa com o endereço.

## Testar no computador

Sirva a pasta extraída por HTTP. Com Python 3, execute `python -m http.server 8000` na pasta e acesse `http://localhost:8000/`. Abra o aplicativo pelo endereço HTTP para que os módulos JavaScript e a leitura de PDF funcionem.

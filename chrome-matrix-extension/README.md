# Google Flights Matrix Capture

Quer pesquisar várias combinações de datas de ida e volta, comparar diferentes durações e encontrar os voos mais baratos com mais facilidade? O calendário do Google Flights mostra poucos resultados de cada vez e torna difícil acompanhar a evolução dos preços? Esta extensão amplia a sua pesquisa, guarda os resultados e permite comparar os preços ao longo do tempo.

Trata-se de uma extensão para Chrome que regista os preços e a disponibilidade encontrados ao pesquisar diferentes datas de viagem (obrigatoriamente Ida+Volta) no Google Flights e permite guardar esses resultados em JSON e Excel.

## Guia rápido para utilizadores

### Instalação

1. Descarregue e descompacte o ZIP da extensão.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo de programador**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta descompactada `chrome-matrix-extension`.
6. Abra ou atualize o Google Flights.

O painel **Matrix capture** aparecerá no canto inferior direito da página.

### Utilização

Inicie a sua pesquisa habitualmente com todos os dados necessários (Origem, Destino, Data de Ida, Data de Volta e Filtros desejados). Nos resultados da pesquisa (Voos de Ida), abra "Calendário" (a matriz de preços do Google Flights) e navegue normalmente pelas datas desejadas. A extensão acumula automaticamente todas as respostas visíveis  durante a nagegação.

- **Parar:** interrompe a captura de novas respostas. Os dados já capturados continuam disponíveis para exportação.
- **Exportar JSON:** descarrega as respostas brutas capturadas na sessão atual em formato JSON.
- **Exportar Excel:** gera um Excel usando o template da extensão e os dados capturados na sessão atual.
- **Atualizar JSON:** pede um JSON já armazenado no seu PC, acrescenta a captura atual, descarrega um novo JSON atualizado e gera um novo Excel atualizado.
- **Gerar Excel do histórico:** pede um JSON já armazenado no seu PC e gera um Excel com todo o histórico nele contido.

Passe o cursor sobre cada botão para ver uma explicação curta da sua função.

### Instalação de uma versão descarregada

O Chrome não instala diretamente este projeto a partir do ZIP. Depois de descarregar uma versão, é necessário descompactá-la e carregá-la como extensão sem compactação através de `chrome://extensions`.

### Limitações e segurança

- A extensão não lê nem exporta cookies, tokens ou cabeçalhos de autenticação.
- CAPTCHA, login e quaisquer desafios de segurança continuam a ser tratados manualmente.
- Os dados são mantidos na memória enquanto a página estiver aberta, até serem exportados.
- Para continuar um histórico existente, utilize o JSON descarregado anteriormente.

----
## Explicação completa do projeto

Extensão para Chrome que acompanha as respostas `GetCalendarGrid` do Google Flights e permite guardar os dados capturados em JSON e Excel.

### Objetivo

O projeto captura respostas da chamada `GetCalendarGrid` utilizada pelo Google Flights para obter combinações de datas, disponibilidade e preços. A extensão transforma essas respostas em dados organizados por combinação de partida e volta e, opcionalmente, por data de pesquisa.

### Componentes principais

- `manifest.json`: define a extensão, os scripts e os recursos acessíveis.
- `content.js`: cria o painel, recebe as respostas, extrai as combinações de datas, atualiza históricos e gera os ficheiros JSON/XLSX.
- `page-hook.js`: é injetado na página para observar as respostas relevantes e enviá-las ao `content.js`.
- `template.xlsx`: template Excel utilizado nas exportações.

### Captura dos dados

Quando a página é carregada, o `content.js` instala o `page-hook.js`. As respostas capturadas são mantidas em `state.responses` durante a sessão. Cada resposta contém, entre outros dados, o corpo retornado pela API, o estado HTTP e a data da captura.

O sistema extrai do corpo da resposta as combinações de data de partida, data de volta, preço e estado `price` ou `no_flights`. Combinações repetidas são consolidadas pela chave `partida|volta`.

### Formato JSON

Uma exportação simples contém a data da exportação, o endpoint e as respostas brutas da sessão. Um histórico pode conter vários `snapshots`, cada um com `capturedAt`, `responses` e `pairs` extraídos das respostas.

O botão **Atualizar JSON** lê o ficheiro escolhido, acrescenta um novo snapshot com as respostas atuais e cria um novo ficheiro. O ficheiro original não é sobrescrito.

### Geração do Excel

As duas opções de Excel utilizam o mesmo gerador. A única diferença é a origem dos dados:

- **Exportar Excel:** usa as respostas capturadas na sessão atual;
- **Gerar Excel do histórico:** usa os snapshots de um JSON escolhido no computador.

O `template.xlsx` é mantido como estrutura principal do workbook. A extensão trata o XLSX como um ZIP e preserva as abas, estilos, fórmulas, gráficos, tabelas, desenhos, relações e configurações de cálculo existentes.

### Atualização incremental da aba Evolução

Na versão atual, apenas a aba **Evolução** recebe dados diretamente. A extensão localiza essa aba pelo nome no `workbook.xml` e atualiza o XML existente de forma incremental.

- Colunas `A` e `B`: datas de partida e de volta.
- Coluna `C` em diante: datas de pesquisa e valores correspondentes.
- Células já existentes: apenas o conteúdo é alterado, preservando os atributos e estilos originais.
- Células novas: são criadas apenas quando o volume de dados ultrapassa a área existente, usando `s="2"` em `A:B` e `s="23"` em `C` em diante.
- A dimensão da worksheet é ampliada quando necessário.

As restantes abas não são recriadas nem substituídas. A aba **Matriz atual** é calculada pelas fórmulas do próprio Excel a partir de **Evolução**. As abas de visualização, gráficos e apoio permanecem parte do template.

O projeto não cria `Matriz_template`, `Evolução_template`, `sheet5.xml` ou `sheet6.xml` adicionais. As partes que já existem no template são preservadas.

### Recálculo do Excel

Antes de gerar o ficheiro, a extensão remove `xl/calcChain.xml`, a relação e o content type correspondentes, configura `calcMode="auto"`, ativa `fullCalcOnLoad="1"` e `forceFullCalc="1"`, e remove apenas os valores cacheados de células que contêm fórmulas nas worksheets dependentes.

As fórmulas não são removidas nem substituídas por valores estáticos. O objetivo é que o Excel recalcule `Matriz atual`, gráficos e painéis assim que o ficheiro for aberto.

### Compatibilidade com múltiplas datas de pesquisa

Quando o JSON contém várias capturas, cada captura ocupa uma nova coluna em **Evolução**. Se forem necessárias células que ainda não existam no XML do template, elas são criadas preservando os estilos aplicáveis das colunas. A formatação condicional existente no template continua a ser preservada.

### Desenvolvimento

O código-fonte da extensão está nesta pasta. Para testar alterações, atualize os ficheiros, abra `chrome://extensions`, clique em **Recarregar**, atualize a página do Google Flights e valide os JSON/XLSX gerados.

Antes de distribuir uma nova versão, confirme que o Excel abre sem reparação, que as fórmulas são recalculadas e que as abas, estilos e gráficos do template permanecem intactos.

### Segurança e limites do projeto

A extensão não lê nem exporta cookies, tokens ou cabeçalhos de autenticação. CAPTCHA, login e desafios de segurança continuam a ser tratados manualmente. Os dados são mantidos na memória da página até serem exportados.

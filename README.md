# Google Flights Matrix Capture

Quer pesquisar várias combinações de datas de ida e volta, comparar diferentes durações e encontrar os voos mais baratos com mais facilidade? O calendário do Google Flights mostra poucos resultados de cada vez e torna difícil acompanhar a evolução dos preços? Esta extensão amplia a sua pesquisa, guarda os resultados e permite comparar os preços ao longo do tempo.

Este projeto contém uma extensão para Chrome que regista os preços e a disponibilidade encontrados ao pesquisar diferentes datas de viagem no Google Flights e permite guardar esses resultados em JSON e Excel.

## Guia rápido

1. Descarregue e descompacte o projeto.
2. Abra `chrome://extensions` no Chrome.
3. Ative o **Modo de programador**.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta `chrome-matrix-extension`.
6. Abra ou atualize o Google Flights.

No Google Flights, preencha a pesquisa, abra **Calendário** nos resultados dos voos de ida e navegue pelas datas desejadas. A extensão acumula automaticamente as respostas visíveis.

## Exemplo visual

### Google Flights e painel da extensão

![Google Flights antes da captura](docs/images/1%20Google%20Flights%20antes%20da%20captura.png)

![Calendário do Google Flights](docs/images/2%20Calend%C3%A1rio%20do%20Google%20Flights.png)

![Painel da extensão](docs/images/3%20Painel%20da%20extens%C3%A3o.png)

![Botões e explicação da extensão](docs/images/4%20Painel%20da%20extens%C3%A3o%20Botoes%20e%20Explicacao.png)

### Excel gerado

![Capa do Excel](docs/images/5%20Excel%20-%20Capa.png)

![Matriz atual no Excel](docs/images/6%20Excel%20-%20Matriz%20atual.png)

![Gráfico do Excel](docs/images/7%20Excel%20-%20Gr%C3%A1fico.png)

### Botões

- **Parar:** interrompe a captura de novas respostas.
- **Exportar JSON:** descarrega as respostas da sessão atual.
- **Exportar Excel:** gera um Excel com os dados capturados na sessão.
- **Atualizar JSON:** acrescenta a captura atual a um JSON já armazenado no computador e gera novos ficheiros JSON e Excel.
- **Gerar Excel do histórico:** gera um Excel a partir de um JSON já armazenado no computador.

## Estrutura do projeto

- `chrome-matrix-extension/`: código da extensão e `template.xlsx`.
- `chrome-matrix-extension/content.js`: painel, captura, históricos e geração de JSON/XLSX.
- `chrome-matrix-extension/page-hook.js`: observação das respostas relevantes do Google Flights.
- `chrome-matrix-extension/README.md`: documentação completa técnica e de utilização.

## Excel e preservação do template

As duas opções de Excel utilizam o mesmo gerador; apenas a origem dos dados é diferente. O template é preservado como estrutura principal do workbook. A extensão atualiza incrementalmente apenas a aba **Evolução**, mantendo estilos, fórmulas, gráficos, tabelas, desenhos e relações existentes. A aba **Matriz atual** é calculada pelas fórmulas do próprio Excel.

O gerador configura o recálculo automático do Excel, remove a cadeia de cálculo antiga quando necessário e preserva as fórmulas originais. Não cria as abas auxiliares `Matriz_template` ou `Evolução_template`.

### Extensão carregada no Chrome

![Extensão carregada no modo programador](docs/images/8%20Extens%C3%A3o%20Carregada%20em%20Modo%20Programador.png)

## Segurança

A extensão não lê nem exporta cookies, tokens ou cabeçalhos de autenticação. CAPTCHA, login e desafios de segurança continuam a ser tratados manualmente. Os dados ficam na memória da página até serem exportados.

Para a explicação completa do funcionamento interno, consulte [`chrome-matrix-extension/README.md`](chrome-matrix-extension/README.md).

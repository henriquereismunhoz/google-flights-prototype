# Google Flights Matrix Capture

Extensão local para capturar respostas `GetCalendarGrid` no Google Flights.

## Instalação no Chrome

1. Abra `chrome://extensions`.
2. Ative **Modo de programador**.
3. Clique em **Carregar sem compactação**.
4. Selecione esta pasta `chrome-matrix-extension`.
5. Abra ou atualize uma página do Google Flights.

O painel **Matrix capture** aparecerá no canto inferior direito. Abra a matriz e navegue normalmente. As respostas serão acumuladas automaticamente. Clique em **Exportar JSON** para descarregar os corpos brutos.

O botão **Parar** impede novas respostas de serem acumuladas, sem apagar as já capturadas.

Esta extensão não lê nem exporta cookies, tokens ou headers de autenticação. Qualquer CAPTCHA continua sendo resolvido manualmente.

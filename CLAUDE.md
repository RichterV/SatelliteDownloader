# SatelliteDownloader

App web estático (sem build, sem backend) que roda inteiro no navegador. O usuário sobe a geometria de uma área (talhões), escolhe satélite e data, e o app encontra a imagem sem nuvem mais próxima, monta um GeoTIFF multibanda recortado e permite baixá-lo.

## Objetivo (requisitos)

- Entrada: `.geojson` ou `.shp` com os polígonos da área.
- Satélites: Sentinel-2 L2A ou Landsat 8/9 (Collection 2 L2).
- Recorte: bounding box dos polígonos + buffer (padrão 500 m, editável).
- Data: busca a imagem mais próxima da data informada, **preferindo datas anteriores** (evita pegar a floresta já colhida). Só usa data posterior se não houver anterior limpa dentro da janela.
- Saída: todas as bandas num único `.tif`, cada banda nomeada conforme o que representa (red, nir, swir_1...), entregue dentro de um `.zip`.

### Situação atual vs. requisitos

- [x] GeoJSON (com `crs` opcional; reprojeta para 4326)
- [x] Shapefile: `.zip` ou arquivos soltos `.shp` + `.dbf` + `.prj` (+ `.cpg`), via `shpjs`
- [x] Sentinel-2 L2A e Landsat 8/9
- [x] Buffer em metros (padrão 500)
- [x] Preferência por data anterior
- [x] TIF multibanda com nome por banda
- [x] Download em `.zip` com o `.tif` dentro (via `fflate`, deflate nível 6, assíncrono)

## Estrutura

```
index.html                 marcação da página (inclui footer com autor/contato); carrega libs da CDN, css/style.css, js/core.js, js/app.js
css/style.css              estilos (tokens em :root, tema escuro via prefers-color-scheme e data-theme)
js/core.js                 núcleo sem DOM; expõe tudo em globalThis.Core
js/app.js                  interface: eventos, tabela de candidatas, preview no canvas, download
favicon.svg                ícone de satélite da aba (+ favicon-32.png e apple-touch-icon.png gerados a partir dele)
plantio_teste.json         GeoJSON de teste
```

Publicado no **GitHub Pages** (site estático, servido em subcaminho `/<repo>/`): manter todos os caminhos locais relativos (sem `/` inicial) e não adicionar nada que exija backend ou build.

Ordem de carregamento importa: `geotiff.js`, `proj4.js`, `shpjs@4.0.4` e `fflate@0.8.2` (CDN, globais `GeoTIFF`, `proj4`, `shp`, `fflate`) antes de `core.js`, que precisa vir antes de `app.js`. Scripts clássicos (não ES modules), então abrir via `file://` funciona.

## Fluxo

1. `Core.readVectorFiles` lê o(s) arquivo(s) selecionado(s) (input `multiple`): GeoJSON direto; shapefile via `shpjs`, que já reprojeta para lon/lat pelo `.prj` (sem `.prj` assume WGS84). Depois `Core.parseGeoJSON` extrai Polygon/MultiPolygon, reprojeta para lon/lat (`ensureProj` suporta WGS84 UTM, SIRGAS 2000 UTM e 4674) e calcula `bboxLL`.
2. `Core.stacSearch` consulta o STAC na janela `data ± N dias` (com paginação).
   - Sentinel-2: Earth Search (AWS Element84), coleção `sentinel-2-l2a`.
   - Landsat: Microsoft Planetary Computer, coleção `landsat-c2-l2`, filtrado para landsat-8/9; hrefs assinados com token SAS (`signHref`).
3. `Core.orderCandidates` deduplica (S2 mantém o maior número de processamento), ordena: anteriores primeiro por proximidade, depois posteriores; desempate por cobertura do footprint e nuvem da cena.
4. `Core.checkCandidate` lê só a janela da máscara (S2 `scl`, Landsat `qa_pixel`), rasteriza os polígonos (scanline + dilatação 1 px) e calcula % nuvem/sombra e % sem dado **dentro dos talhões**. Aprovada se nodata = 0 e nuvem <= tolerância. Cenas com nuvem >= 99% são puladas.
5. `Core.loadImage` lê todas as bandas via COG (HTTP range, `readRasters` com window), reamostrando por vizinho mais próximo para a grade da banda de referência (S2 `blue` 10 m, Landsat `red` 30 m). Concorrência 4 (`pool`).
6. Preview em canvas com composições (cor verdadeira, falsa cor, etc.) e stretch 2-98%. Botão "Não gostei" rejeita e segue para a próxima candidata.
7. `Core.buildGeoTIFF` escreve o TIFF à mão: uint16, planar separado, sem compressão, GeoKeys com o EPSG da cena, e `GDALMetadata` (tag 42112) com `DESCRIPTION` por banda (nome que aparece no QGIS/rasterio), `BAND_CODE`, `PHYSICAL_SCALE/OFFSET` e metadados da cena. NoData = 0 (tag 42113). Limite 4 GB (TIFF clássico).
8. `Core.zipFile` compacta o `.tif` num `.zip` de mesmo nome, que é o que o usuário baixa.

## Detalhes importantes

- Valores no TIF são DN brutos. Reflectância:
  - S2: `DN * 0.0001`, com offset `-0.1` quando baseline >= 04.00 e `earthsearch:boa_offset_applied === false`.
  - Landsat: `DN * 0.0000275 - 0.2`; térmico (`ST_B10`) em K: `DN * 0.00341802 + 149`.
- Landsat usa `RasterPixelIsPoint`; `gridOf` desloca meio pixel como o GDAL.
- Nome do arquivo: `<nome_do_arquivo_vetorial>_<S2|LS>_<YYYY-MM-DD>.zip`, contendo o `.tif` com o mesmo nome.
- Toda configuração por sensor (bandas, máscara, escala, composições, endpoints) fica no objeto `SENSORS` em `core.js`. Para adicionar banda/sensor, editar lá.
- `state.run` em `app.js` cancela buscas antigas quando o usuário dispara outra.
- Textos da interface em português, curtos (usuários internos da Treevia). Layout: formulário fixo à esquerda (parâmetros secundários em "Avançado"), prévia e resultado à direita, tabela de cenas recolhível. Tema claro/escuro por tokens CSS em `:root`.

## Testar

Abrir `index.html` no navegador (ou servir a pasta com `python -m http.server`), carregar `plantio_teste.json` (ou um shapefile), buscar e baixar o `.zip`. Validar o `.tif` no QGIS ou com `gdalinfo` (nomes das bandas, EPSG, alinhamento com os polígonos).

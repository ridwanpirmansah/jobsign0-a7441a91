<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Thermal printing composes the unchanged receipt and an order-data footer into a single raster page; fixed-height mode uses physical dot resolution and no trailing line feeds so each job advances one configured label pitch.
- Order print labels are read through an authenticated server function with user-scoped access, resolving referenced stock/draft names and dimensions rather than relying on incomplete preview payloads.
- Shopee preview and import share a pure target validator: a stock/draft/consumed source is never an update target, and consuming stock does not transfer its original Shopee sale to the consuming order, because these may be different buyers.

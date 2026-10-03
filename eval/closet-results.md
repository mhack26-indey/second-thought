# Closet eval

15 real outfit photos of one person (`demo_images/`, not checked in) against hand labels (`demo_images/labels.json`: 31 items, 50 appearances). Run 2026-10-03, 17.5 min, vision model `google/gemini-3.8-flash`. One run; model answers vary between runs. Merge scoring and shopping skip appearances labeled unsure. Produced by `bun run eval:closet`.

| Metric | Result |
|---|---|
| Photos | 15 (model called 15 fit_check; all ingested as fit checks) |
| Unique items created vs true unique labels | 36 vs 31 (5 items match no label) |
| Missed merges (one label split into several items) | 0 of 6 repeated labels |
| Wrong merges (different labels in one item) | 0 items |
| Extraction: labeled items found, right category | 50/50 (100%) |
| Extraction: right category and color | 44/50 (88%) |
| Shopping match precision@1 | 6/6 (100%) |
| Shopping match in top 3 | 6/6 (100%) |
| Comparisons that fell back to name matching | 0 (main run) |

## Labels and the items they became

| Label | Sure photos | Items (wear count) |
|---|---|---|
| black-adidas-sambas | 2 | black and white low-top sneakers with gum sole (3) |
| black-smartwatch | 2 | black smartwatch (3) |
| khaki-chinos | 2 | beige straight-leg chinos (2) |
| navy-polo | 2 | navy blue short-sleeve polo shirt (3) |
| olive-tote | 2 | olive green canvas tote or messenger bag with brown strap (2) |
| red-puffer | 2 | red quilted puffer jacket with hood (2) |
| beige-knit-polo | 1 | short-sleeve beige button-up collared shirt (1) |
| black-bracelet | 1 | thin black string bracelet (1) |
| black-chinos | 1 | black straight-leg trousers (2) |
| black-dress-shoes | 1 | black leather dress shoes (1) |
| black-longsleeve | 1 | black long-sleeve crewneck shirt (1) |
| black-nike-cargo-joggers | 1 | black nike cargo sweatpants with white logo (1) |
| black-nike-sneakers | 1 | black athletic running sneakers with white soles (1) |
| black-sunglasses | 1 | black sunglasses perched on head (2) |
| blue-dress-shirt | 1 | royal blue collared dress shirt (1) |
| blue-suit-jacket | 1 | blue suit blazer jacket (1) |
| blue-suit-pants | 1 | matching blue suit trousers (1) |
| charcoal-knit-quarterzip | 1 | dark grey quarter-zip knit sweater (2) |
| gray-puma-sweatpants | 1 | grey puma sweatpants with drawstring (2) |
| light-gray-dress-pants | 1 | light grey dress trousers (1) |
| light-gray-tee | 1 | light grey crewneck t-shirt (2) |
| navy-adidas-shorts | 1 | black athletic shorts with small white logo (1) |
| navy-suit-jacket | 1 | navy single-breasted suit blazer (1) |
| navy-suit-pants | 1 | navy suit trousers (1) |
| navy-sweatpants | 1 | navy blue drawstring sweatpants (1) |
| olive-adidas-shorts | 1 | olive green athletic shorts with black adidas logo (1) |
| olive-fleece-quarterzip | 1 | olive fleece quarter-zip pullover sweater (1) |
| red-columbia-tee | 1 | red columbia logo t-shirt (1) |
| sage-abercrombie-tee | 1 | sage green crewneck short-sleeve t-shirt with small chest logo (1) |
| white-dress-shirt | 1 | white formal dress shirt (2) |
| white-green-adidas-sneakers | 1 | white sneakers with green and red stripes (2) |

## Missed merges

None.

## Wrong merges

None.

## Items that match no label

- black bag with patterned strap over shoulder (1 wears)
- khaki casual shorts (1 wears)
- dark charcoal tapered sweatpants (1 wears)
- navy blue single-breasted blazer with event pins and badge (1 wears)
- black leather formal dress shoes (1 wears)

## Extraction misses

- black-nike-cargo-joggers in IMG-20260814-WA00002.jpg: color "charcoal"
- sage-abercrombie-tee in P7143138.jpg: color "grey"
- navy-adidas-shorts in P7143138.jpg: color "black"
- olive-adidas-shorts in Screenshot_20261003-183523.png: color "khaki"
- white-green-adidas-sneakers in Screenshot_20261003-183523.png: color "black"
- sage-abercrombie-tee in Screenshot_20261003-184035.png: color "grey"

## Shopping match (held-out photo vs the closet from the other photos)

| Label | Held out | @1 | Top 3 | Top matches (✓ = right item) |
|---|---|---|---|---|
| navy-polo | PXL_20260727_232949503.RAW-01.jpg | yes | yes | navy blue short-sleeve polo shirt ✓ |
| khaki-chinos | PXL_20260727_232949503.RAW-01.jpg | yes | yes | beige straight-leg chinos ✓ |
| olive-tote | PXL_20260727_232949503.RAW-01.jpg | yes | yes | olive green canvas tote or messenger bag with brown strap ✓ |
| black-smartwatch | PXL_20260727_232949503.RAW-01.jpg | yes | yes | black smartwatch ✓ |
| red-puffer | Screenshot_20261003-184451.png | yes | yes | red quilted puffer jacket with hood ✓ |
| black-adidas-sambas | IMG-20260814-WA00002.jpg | yes | yes | black and white low-top sneakers with gum sole ✓ |

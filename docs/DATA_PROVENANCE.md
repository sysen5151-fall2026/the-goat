# NYC Catalog Provenance

`data/nyc-poi-v1.json` is a 40-place seed catalog for the MVP. It was reviewed
on October 5, 2026. The catalog records a primary public source for each place;
it is not a real-time feed. Coordinates and USD planning allowances are used to
exercise the product flow and should be revalidated before a production release.

| Place | Primary source |
| --- | --- |
| Statue of Liberty National Monument | National Park Service — `nps.gov/stli` |
| Ellis Island National Museum of Immigration | National Park Service — `nps.gov/elis` |
| Brooklyn Bridge | NYC Department of Transportation — `nyc.gov` |
| One World Observatory | One World Observatory — `oneworldobservatory.com` |
| 9/11 Memorial & Museum | 9/11 Memorial & Museum — `911memorial.org` |
| New York Public Library, Stephen A. Schwarzman Building | New York Public Library — `nypl.org` |
| Grand Central Terminal | Grand Central Terminal — `grandcentralterminal.com` |
| Empire State Building | Empire State Building — `esbnyc.com` |
| Times Square | Times Square Alliance — `timessquarenyc.org` |
| Rockefeller Center | Rockefeller Center — `rockefellercenter.com` |
| The Museum of Modern Art | The Museum of Modern Art — `moma.org` |
| Central Park | Central Park Conservancy — `centralparknyc.org` |
| The Metropolitan Museum of Art | The Metropolitan Museum of Art — `metmuseum.org` |
| American Museum of Natural History | American Museum of Natural History — `amnh.org` |
| Solomon R. Guggenheim Museum | Guggenheim Museum — `guggenheim.org` |
| The High Line | Friends of the High Line — `thehighline.org` |
| Chelsea Market | Chelsea Market — `chelseamarket.com` |
| Edge at Hudson Yards | Edge — `edgenyc.com` |
| Intrepid Sea, Air & Space Museum | Intrepid Museum — `intrepidmuseum.org` |
| Brooklyn Museum | Brooklyn Museum — `brooklynmuseum.org` |
| Brooklyn Bridge Park | Brooklyn Bridge Park — `brooklynbridgepark.org` |
| Prospect Park | Prospect Park Alliance — `prospectpark.org` |
| Brooklyn Botanic Garden | Brooklyn Botanic Garden — `bbg.org` |
| The Met Cloisters | The Metropolitan Museum of Art — `metmuseum.org` |
| Whitney Museum of American Art | Whitney Museum of American Art — `whitney.org` |
| Staten Island Ferry | Staten Island Ferry — `siferry.com` |
| Governors Island | Trust for Governors Island — `govisland.com` |
| Little Island | Little Island — `littleisland.org` |
| Washington Square Park | NYC Parks — `nycgovparks.org` |
| SUMMIT One Vanderbilt | SUMMIT One Vanderbilt — `summitov.com` |
| St. Patrick's Cathedral | St. Patrick's Cathedral — `saintpatrickscathedral.org` |
| Bryant Park | Bryant Park Corporation — `bryantpark.org` |
| New York Botanical Garden | New York Botanical Garden — `nybg.org` |
| Bronx Zoo | Wildlife Conservation Society — `bronxzoo.com` |
| Tenement Museum | Tenement Museum — `tenement.org` |
| Essex Market | Essex Market — `essexmarket.nyc` |
| Katz's Delicatessen | Katz's Delicatessen — `katzsdelicatessen.com` |
| Coney Island Beach & Boardwalk | NYC Parks — `nycgovparks.org` |
| Roosevelt Island Tramway | Roosevelt Island Operating Corporation — `rioc.ny.gov` |
| The Frick Collection | The Frick Collection — `frick.org` |

## Data rules

- `published: true` is required before a record can be selected.
- `planningAllowanceUsd` is an internal planning allowance, not a quoted ticket
  price, fare, or food bill.
- `sourceUrl` is presented to the visitor so that current conditions can be
  checked outside the product.
- A future release must add a dated review record before changing an existing
  place's source, coordinates, tags, access note, or allowance.

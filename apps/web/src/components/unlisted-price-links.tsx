import { ExternalLink } from 'lucide-react';

/**
 * Kosh does NOT scrape unlisted-share sites (docs/prices.md: they block automated clients or their
 * terms forbid copying/reproducing prices). Instead, link the user to public price lists so they
 * can check an indicative quote and update the price themselves.
 */
const SITES = [
  { name: 'SharesCart', url: 'https://www.sharescart.com/unlisted-shares' },
  { name: 'UnlistedZone', url: 'https://unlistedzone.com/unlisted-shares-price-list-india' },
  { name: 'Precize', url: 'https://www.precize.in/shares/all' },
];

export function UnlistedPriceLinks() {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
      <p className="font-medium">Check an indicative price</p>
      <p className="text-xs text-muted-foreground">
        Dealer quotes differ between sites. Kosh doesn’t copy them automatically; look one up and
        use Update price.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {SITES.map((s) => (
          <li key={s.name}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex min-h-6 items-center gap-1 text-primary underline-offset-2 hover:underline"
            >
              {s.name}
              <ExternalLink aria-hidden className="size-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

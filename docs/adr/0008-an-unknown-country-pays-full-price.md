# A buyer whose country is unknown pays full price, and we never look it up

Purchasing-power prices depend on the buyer's country, which `resolveCountry` reads only from the `CF-IPCountry` header (or the DevUI override). When the header is missing, the buyer pays full price. This overcharges exactly the Students purchasing-power pricing is for, but it means no page ever waits on a network call to learn the country.

`resolveCountry` used to fall back to looking up the first `X-Forwarded-For` address on ip-api.com. We removed it and went back to full price, because the course list, the purchase page and every lesson page of a discounted purchase waited on that call, and the free endpoint is plain HTTP and limited to 45 requests a minute.

## Considered Options

- **Bundle a MaxMind GeoLite2 database.** Rejected: it needs a licence key, a download of tens of megabytes, and an update every month.

// The child API approves this fixture destination; the parent worker still tests DNS failure/retry.
const dns = require("node:dns/promises");
const lookup = dns.lookup;
dns.lookup = (hostname, options) =>
  hostname === "payments.example.com"
    ? Promise.resolve([{ address: "8.8.8.8", family: 4 }])
    : lookup(hostname, options);

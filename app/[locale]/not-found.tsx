// A server module on purpose. With "use client" this re-export was a client
// entry of its own, and the store's not-found page it names — illustration,
// cards, links — shipped twice in every storefront page's first-load JS: once
// for this boundary, once for (store)/not-found.tsx. As a server re-export
// both boundaries name the same client module.
export { default } from "./(store)/not-found";

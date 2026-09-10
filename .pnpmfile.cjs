/**
 * better-auth declares `vitest` as an optional peer dependency for its
 * bundled test utilities. This project does not use vitest or those
 * utilities, so the declaration is stripped here to keep the package out of
 * the dependency metadata pnpm records in pnpm-lock.yaml. Nothing is ever
 * installed for an unsatisfied optional peer, so this only removes inert
 * metadata; it does not change the installed dependency tree.
 */
function readPackage(pkg) {
  if (pkg.name === "better-auth") {
    if (pkg.peerDependencies) delete pkg.peerDependencies.vitest;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.vitest;
  }
  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};

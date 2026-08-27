/**
 * Extension.js ships these declarations, but its type entrypoint is a module,
 * so TypeScript reads them as module augmentations rather than as ambient
 * wildcards and never matches an import against them. Declaring them here, in
 * a script file, is what makes them apply.
 */

declare module "*.css" {
  /**
   * The scoped class names of a `*.module.css` file, which Extension.js
   * compiles with named exports — hence `import * as styles`. Plain
   * stylesheets are imported for their side effect only, but TypeScript
   * matches both against this single wildcard.
   */
  const classNames: Readonly<Record<string, string>>;
  export = classNames;
}

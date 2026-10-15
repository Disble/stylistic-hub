// dharness writes this file. It exports a factory rather than a config
// array because the packages it names are installed beside the project's
// package.json, and a bare specifier resolves from the file that writes it
// — which, in a split layout, is not this directory.
export default function dharnessLayer({ plugin }) {
  return [
    { ignores: [".dharness/**"] },
    {
      // dharness's own source matchers, case-folded because flat-config
      // globs are case-sensitive and IsSourceFile's extension check is not.
      files: [
        "**/*.[tT][sS]",
        "**/*.[tT][sS][xX]",
        "**/*.[jJ][sS]",
        "**/*.[jJ][sS][xX]",
        "**/*.[mM][tT][sS]",
        "**/*.[cC][tT][sS]",
        "**/*.[mM][jJ][sS]",
        "**/*.[cC][jJ][sS]",
      ],
      plugins: { dharness: plugin },
      rules: {
        "dharness/folder-ownership": "error",
        "dharness/max-file-lines": "error",
        "dharness/pure-index-barrel": "error",
        "dharness/require-jsdoc": "error",
        "dharness/require-variable-jsdoc": "error",
        "dharness/role-file-shape": "error",
      },
    },
  ];
}

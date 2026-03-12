module.exports = {
  enable: false,
  mode: "random", // Obfuscate class names to random strings
  refreshClassConversionJson: false,
  allowExtensions: [".jsx", ".tsx", ".js", ".ts", ".html", ".rsc"],
  ignorePatterns: {
      selectors: [
          "^.dark", 
          "data-", 
          "transition-", 
          "^z-",
          "^fixed",
          "^absolute",
          "^relative",
          "^inset-",
          "^w-",
          "^h-",
          "^min-w-",
          "^min-h-",
          "^max-w-",
          "^max-h-",
          "^overflow-",
          "^transform",
          "^translate-",
          "^animate-",
          "^fade-",
          "^slide-",
          "^zoom-",
          "^cursor-",
          "^pointer-events-",
          "^opacity-",
          "^flex",
          "^grid",
          "^gap-",
          "^items-",
          "^justify-",
          "^space-",
          "^p-",
          "^m-"
      ] 
  }
};

const ts = require('typescript');
const path = require('path');

const filePath = path.resolve(__dirname, 'src/lib/application/services/quotes/management/ReviseQuoteCommandHandler.ts');

const program = ts.createProgram([filePath], {
  target: ts.ScriptTarget.ES2017,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  esModuleInterop: true,
  strict: true,
});

const sourceFile = program.getSourceFile(filePath);
if (!sourceFile) {
  console.error("Could not find source file");
  process.exit(1);
}

const checker = program.getTypeChecker();

function visit(node) {
  if (ts.isNewExpression(node)) {
    if (node.expression.getText() === 'QuoteVersion') {
      const symbol = checker.getSymbolAtLocation(node.expression);
      if (symbol) {
        console.log("Found QuoteVersion symbol:");
        const declarations = symbol.getDeclarations();
        if (declarations) {
          declarations.forEach(decl => {
            console.log("Declared in:", decl.getSourceFile().fileName);
            console.log("Declaration kind:", ts.SyntaxKind[decl.kind]);
            console.log("Text:", decl.getText().substring(0, 100));
          });
        }
        
        const type = checker.getTypeOfSymbolAtLocation(symbol, node);
        console.log("Type:", checker.typeToString(type));
        console.log("Properties:");
        type.getProperties().forEach(p => console.log(" - " + p.getName()));
        
        const instanceType = checker.getTypeAtLocation(node);
        console.log("Instance Type properties:");
        instanceType.getProperties().forEach(p => console.log(" - " + p.getName()));
      }
    }
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);

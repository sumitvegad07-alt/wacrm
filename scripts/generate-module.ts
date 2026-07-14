import * as fs from 'fs';
import * as path from 'path';

const moduleNameArg = process.argv[2];
if (!moduleNameArg) {
  console.error("Usage: npx tsx scripts/generate-module.ts <ModuleName>");
  process.exit(1);
}

const moduleName = moduleNameArg.charAt(0).toUpperCase() + moduleNameArg.slice(1);
const moduleLower = moduleName.toLowerCase();

const basePath = path.join(process.cwd(), 'src');

console.log(`Generating Enterprise Module: ${moduleName}...`);

// 1. Generate Domain Entity & DTO
const domainPath = path.join(basePath, `lib/domain/entities`);
if (!fs.existsSync(domainPath)) fs.mkdirSync(domainPath, { recursive: true });
fs.writeFileSync(path.join(domainPath, `${moduleName}.ts`), `export interface ${moduleName} {\n  id: string;\n  name: string;\n  sync_status: string;\n}\n`);

// 2. Generate Repository
const repoPath = path.join(basePath, `lib/repositories/implementations`);
if (!fs.existsSync(repoPath)) fs.mkdirSync(repoPath, { recursive: true });
fs.writeFileSync(path.join(repoPath, `${moduleLower}.repository.ts`), `
export class ${moduleName}Repository {
  async create(data: any): Promise<void> {}
  async update(id: string, data: any): Promise<void> {}
  async delete(id: string): Promise<void> {}
}
`);

// 3. Generate Application Services
const appServicePath = path.join(basePath, `lib/application/services/${moduleLower}`);
if (!fs.existsSync(appServicePath)) fs.mkdirSync(appServicePath, { recursive: true });
fs.writeFileSync(path.join(appServicePath, `Create${moduleName}CommandHandler.ts`), `
import { ICommand, ICommandHandler } from '../../core/CqrsInterfaces';
import { ApplicationResult } from '../../core/ApplicationResult';

export class Create${moduleName}Command implements ICommand {
  constructor(public readonly id: string, public readonly name: string) {}
}

export class Create${moduleName}CommandHandler implements ICommandHandler<Create${moduleName}Command, string> {
  constructor(private readonly repository: any, private readonly domainEventBus: any, private readonly unitOfWork: any) {}
  async execute(command: Create${moduleName}Command): Promise<ApplicationResult<string>> {
    return ApplicationResult.success(command.id);
  }
}
`);

// 4. Generate UI DTO
const uiDtoPath = path.join(basePath, `lib/presentation/dtos`);
if (!fs.existsSync(uiDtoPath)) fs.mkdirSync(uiDtoPath, { recursive: true });
fs.writeFileSync(path.join(uiDtoPath, `${moduleName}UiDto.ts`), `
export class ${moduleName}UiDto {
  public readonly id: string;
  public readonly name: string;
  public readonly syncBadge: string;
  constructor(entity: any) {
    this.id = entity.id;
    this.name = entity.name;
    this.syncBadge = entity.sync_status === 'pending' ? 'pending' : 'synced';
  }
}
`);

// 5. Generate Feature Hook
const hooksPath = path.join(basePath, `hooks/features`);
if (!fs.existsSync(hooksPath)) fs.mkdirSync(hooksPath, { recursive: true });
fs.writeFileSync(path.join(hooksPath, `use${moduleName}s.ts`), `
import { useState } from 'react';
import { useApplication } from '../../components/providers/ApplicationProvider';

export const use${moduleName}s = () => {
  const application = useApplication();
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const create = async (name: string) => {
    setIsLoading(true);
    // Call application handler
    setIsLoading(false);
  };

  return { items, create, isLoading };
};
`);

console.log('✓ Scaffold generated.');

// 6. Auto-register in CompositionRoot (Naive regex injection for now)
const crPath = path.join(basePath, `lib/application/core/CompositionRoot.ts`);
if (fs.existsSync(crPath)) {
  let crContent = fs.readFileSync(crPath, 'utf8');
  
  const importStatement = `import { Create${moduleName}CommandHandler } from '../services/${moduleLower}/Create${moduleName}CommandHandler';\n`;
  crContent = importStatement + crContent;

  const propDeclaration = `  public create${moduleName}Handler: Create${moduleName}CommandHandler;\n`;
  crContent = crContent.replace(/(public [a-zA-Z]+Handler: [a-zA-Z]+CommandHandler;)/, `$1\n${propDeclaration}`);

  const instantiation = `    this.create${moduleName}Handler = new Create${moduleName}CommandHandler(\n      this.repositories.${moduleLower}Repository,\n      this.domainEventBus,\n      this.unitOfWork\n    );\n`;
  crContent = crContent.replace(/(this\.[a-zA-Z]+Handler = new [a-zA-Z]+CommandHandler\([\s\S]+?\);)/, `$1\n\n${instantiation}`);

  fs.writeFileSync(crPath, crContent);
  console.log(`✓ Auto-registered in CompositionRoot.ts.`);
}

console.log(`Done! ${moduleName} module is ready for development.`);

export interface SkillDefinition {
    id: string;
    name: string;
    normalizedName: string;
    path: string;
    description: string;
    dependencies: string[];
    source: SkillSource;
    status: SkillStatus;
    isSynced?: boolean;
}

export enum SkillStatus {
    Active = "active",
    Missing = "missing",
    Imported = "imported",
}

export enum SkillSource {
    Agent = ".agent/skills",
    CursorRules = ".cursor/rules",
    CursorSkills = ".cursor/skills",
    Global = "~/open-skills",
    Custom = "custom",
}

export enum FolderStructure {
    Flat = "flat",
    Hierarchical = "hierarchical",
    AutoDetect = "auto-detect",
}

export interface GapAnalysisResult {
    present: SkillDefinition[];
    missing: SkillDefinition[];
    totalAvailable: number;
    coveragePercentage: number;
}

export interface SkillScanResult {
    skills: SkillDefinition[];
    scanPaths: string[];
    timestamp: number;
}

export interface ExtensionConfig {
    customScanPaths: string[];
    folderStructure: FolderStructure;
    ideType: string;
    onboardingCompleted: boolean;
    targetImportPath: string;
    globalSkillsPath: string;
    showStatusBar: boolean;
    scanOnStartup: boolean;
}

export interface SkillRepository {
    owner: string;
    repo: string;
    path: string;
    branch: string;
    singleSkill?: boolean;
}

export interface SkillMetadata {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string;
}

export interface MarketplaceSkill {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    source: SkillRepository;
    skillPath: string;
    fullContent: string;
    bodyContent: string;
}

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

export * from "../constants";

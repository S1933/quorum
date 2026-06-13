import {
  mkdir,
  readdir,
  readlink,
  stat,
  symlink,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const home = homedir();

const skillsSource = join(root, 'skills');
const skillsTarget = join(home, '.agents', 'skills');

let sourceStat;
try {
  sourceStat = await stat(skillsSource);
} catch {
  process.exit(0);
}

if (!sourceStat.isDirectory()) {
  process.exit(0);
}

await mkdir(skillsTarget, { recursive: true });

const entries = await readdir(skillsSource, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory()) continue;

  const skillDir = join(skillsSource, entry.name);
  const skillFile = join(skillDir, 'SKILL.md');
  try {
    await stat(skillFile);
  } catch {
    continue;
  }

  const linkPath = join(skillsTarget, `quorum-${entry.name}`);
  const existingTarget = await readlink(linkPath).catch(() => null);
  if (existingTarget === skillDir) {
    console.log(`exists, skipping: ${linkPath}`);
    continue;
  }
  if (existingTarget) {
    await unlink(linkPath);
  }
  await symlink(skillDir, linkPath);
  console.log(`symlink ${entry.name} → ${linkPath}`);
}

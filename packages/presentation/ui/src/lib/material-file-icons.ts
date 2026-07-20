/// <reference types="unplugin-icons/types/react" />

import AdobeIllustratorFileIcon from '~icons/material-icon-theme/adobe-illustrator';
import AdobePhotoshopFileIcon from '~icons/material-icon-theme/adobe-photoshop';
import AndroidFileIcon from '~icons/material-icon-theme/android';
import AngularFileIcon from '~icons/material-icon-theme/angular';
import AstroFileIcon from '~icons/material-icon-theme/astro';
import AstroConfigFileIcon from '~icons/material-icon-theme/astro-config';
import BabelFileIcon from '~icons/material-icon-theme/babel';
import BiomeFileIcon from '~icons/material-icon-theme/biome';
import BlenderFileIcon from '~icons/material-icon-theme/blender';
import BunFileIcon from '~icons/material-icon-theme/bun';
import CFileIcon from '~icons/material-icon-theme/c';
import CppFileIcon from '~icons/material-icon-theme/cpp';
import CSharpFileIcon from '~icons/material-icon-theme/csharp';
import CssFileIcon from '~icons/material-icon-theme/css';
import DartFileIcon from '~icons/material-icon-theme/dart';
import DenoFileIcon from '~icons/material-icon-theme/deno';
import DockerFileIcon from '~icons/material-icon-theme/docker';
import EslintFileIcon from '~icons/material-icon-theme/eslint';
import FigmaFileIcon from '~icons/material-icon-theme/figma';
import GemfileIcon from '~icons/material-icon-theme/gemfile';
import GitFileIcon from '~icons/material-icon-theme/git';
import GoFileIcon from '~icons/material-icon-theme/go';
import GoModFileIcon from '~icons/material-icon-theme/go-mod';
import GradleFileIcon from '~icons/material-icon-theme/gradle';
import GraphqlFileIcon from '~icons/material-icon-theme/graphql';
import HFileIcon from '~icons/material-icon-theme/h';
import HppFileIcon from '~icons/material-icon-theme/hpp';
import HtmlFileIcon from '~icons/material-icon-theme/html';
import JarFileIcon from '~icons/material-icon-theme/jar';
import JavaFileIcon from '~icons/material-icon-theme/java';
import JavaScriptFileIcon from '~icons/material-icon-theme/javascript';
import JsconfigFileIcon from '~icons/material-icon-theme/jsconfig';
import KotlinFileIcon from '~icons/material-icon-theme/kotlin';
import LessFileIcon from '~icons/material-icon-theme/less';
import MarkdownFileIcon from '~icons/material-icon-theme/markdown';
import MavenFileIcon from '~icons/material-icon-theme/maven';
import MdxFileIcon from '~icons/material-icon-theme/mdx';
import NextFileIcon from '~icons/material-icon-theme/next';
import NodeFileIcon from '~icons/material-icon-theme/nodejs';
import NpmFileIcon from '~icons/material-icon-theme/npm';
import NuxtFileIcon from '~icons/material-icon-theme/nuxt';
import PdfFileIcon from '~icons/material-icon-theme/pdf';
import PhpFileIcon from '~icons/material-icon-theme/php';
import PlaywrightFileIcon from '~icons/material-icon-theme/playwright';
import PnpmFileIcon from '~icons/material-icon-theme/pnpm';
import PostcssFileIcon from '~icons/material-icon-theme/postcss';
import PowerpointFileIcon from '~icons/material-icon-theme/powerpoint';
import PowershellFileIcon from '~icons/material-icon-theme/powershell';
import PrettierFileIcon from '~icons/material-icon-theme/prettier';
import PrismaFileIcon from '~icons/material-icon-theme/prisma';
import PythonFileIcon from '~icons/material-icon-theme/python';
import ReactFileIcon from '~icons/material-icon-theme/react';
import ReactTypeScriptFileIcon from '~icons/material-icon-theme/react-ts';
import RollupFileIcon from '~icons/material-icon-theme/rollup';
import RubyFileIcon from '~icons/material-icon-theme/ruby';
import RustFileIcon from '~icons/material-icon-theme/rust';
import SassFileIcon from '~icons/material-icon-theme/sass';
import SketchFileIcon from '~icons/material-icon-theme/sketch';
import SolidityFileIcon from '~icons/material-icon-theme/solidity';
import StorybookFileIcon from '~icons/material-icon-theme/storybook';
import SvelteFileIcon from '~icons/material-icon-theme/svelte';
import SwiftFileIcon from '~icons/material-icon-theme/swift';
import TailwindFileIcon from '~icons/material-icon-theme/tailwindcss';
import TerraformFileIcon from '~icons/material-icon-theme/terraform';
import TestJavaScriptFileIcon from '~icons/material-icon-theme/test-js';
import TestJsxFileIcon from '~icons/material-icon-theme/test-jsx';
import TestTypeScriptFileIcon from '~icons/material-icon-theme/test-ts';
import TypeScriptConfigFileIcon from '~icons/material-icon-theme/tsconfig';
import TypeScriptFileIcon from '~icons/material-icon-theme/typescript';
import TypeScriptDefFileIcon from '~icons/material-icon-theme/typescript-def';
import UnityFileIcon from '~icons/material-icon-theme/unity';
import ViteFileIcon from '~icons/material-icon-theme/vite';
import VitestFileIcon from '~icons/material-icon-theme/vitest';
import VueFileIcon from '~icons/material-icon-theme/vue';
import VueConfigFileIcon from '~icons/material-icon-theme/vue-config';
import WebpackFileIcon from '~icons/material-icon-theme/webpack';
import WordFileIcon from '~icons/material-icon-theme/word';
import XmlFileIcon from '~icons/material-icon-theme/xml';
import YarnFileIcon from '~icons/material-icon-theme/yarn';

export type MaterialFileIcon = typeof AngularFileIcon;

export const MATERIAL_FILE_NAME_ICONS: Readonly<Partial<Record<string, MaterialFileIcon>>> = {
  '.babelrc': BabelFileIcon,
  '.babelrc.json': BabelFileIcon,
  '.dockerignore': DockerFileIcon,
  '.eslintrc': EslintFileIcon,
  '.eslintrc.cjs': EslintFileIcon,
  '.eslintrc.js': EslintFileIcon,
  '.eslintrc.json': EslintFileIcon,
  '.eslintrc.yaml': EslintFileIcon,
  '.eslintrc.yml': EslintFileIcon,
  '.gitattributes': GitFileIcon,
  '.gitignore': GitFileIcon,
  '.gitkeep': GitFileIcon,
  '.gitmodules': GitFileIcon,
  '.npmignore': NpmFileIcon,
  '.npmrc': NpmFileIcon,
  '.nvmrc': NodeFileIcon,
  '.pnpmfile.cjs': PnpmFileIcon,
  '.prettierrc': PrettierFileIcon,
  '.prettierrc.json': PrettierFileIcon,
  '.prettierrc.cjs': PrettierFileIcon,
  '.prettierrc.js': PrettierFileIcon,
  '.prettierrc.yaml': PrettierFileIcon,
  '.prettierrc.yml': PrettierFileIcon,
  '.yarnrc': YarnFileIcon,
  '.yarnrc.yml': YarnFileIcon,
  'angular.json': AngularFileIcon,
  'biome.json': BiomeFileIcon,
  'biome.jsonc': BiomeFileIcon,
  'build.gradle': GradleFileIcon,
  'build.gradle.kts': GradleFileIcon,
  'bun.lock': BunFileIcon,
  'bun.lockb': BunFileIcon,
  'bunfig.toml': BunFileIcon,
  'cargo.lock': RustFileIcon,
  'cargo.toml': RustFileIcon,
  'compose.yaml': DockerFileIcon,
  'compose.yml': DockerFileIcon,
  'deno.json': DenoFileIcon,
  'deno.jsonc': DenoFileIcon,
  'docker-compose.yaml': DockerFileIcon,
  'docker-compose.yml': DockerFileIcon,
  dockerfile: DockerFileIcon,
  gemfile: GemfileIcon,
  'gemfile.lock': GemfileIcon,
  'go.mod': GoModFileIcon,
  'go.sum': GoModFileIcon,
  'go.work': GoModFileIcon,
  'gradle.properties': GradleFileIcon,
  'jsconfig.json': JsconfigFileIcon,
  'package-lock.json': NpmFileIcon,
  'package.json': NodeFileIcon,
  'npm-shrinkwrap.json': NpmFileIcon,
  'playwright.config.js': PlaywrightFileIcon,
  'playwright.config.ts': PlaywrightFileIcon,
  'pnpm-lock.yaml': PnpmFileIcon,
  'pnpm-workspace.yaml': PnpmFileIcon,
  'pom.xml': MavenFileIcon,
  'requirements.txt': PythonFileIcon,
  'settings.gradle': GradleFileIcon,
  'settings.gradle.kts': GradleFileIcon,
  'tsconfig.json': TypeScriptConfigFileIcon,
  'yarn.lock': YarnFileIcon,
};

export const MATERIAL_FILE_NAME_PREFIX_ICONS: ReadonlyArray<readonly [string, MaterialFileIcon]> = [
  ['astro.config.', AstroConfigFileIcon],
  ['babel.config.', BabelFileIcon],
  ['eslint.config.', EslintFileIcon],
  ['jsconfig.', JsconfigFileIcon],
  ['next.config.', NextFileIcon],
  ['nuxt.config.', NuxtFileIcon],
  ['playwright.config.', PlaywrightFileIcon],
  ['postcss.config.', PostcssFileIcon],
  ['prettier.config.', PrettierFileIcon],
  ['rollup.config.', RollupFileIcon],
  ['svelte.config.', SvelteFileIcon],
  ['tailwind.config.', TailwindFileIcon],
  ['tsconfig.', TypeScriptConfigFileIcon],
  ['vite.config.', ViteFileIcon],
  ['vitest.config.', VitestFileIcon],
  ['vue.config.', VueConfigFileIcon],
  ['webpack.config.', WebpackFileIcon],
];

export const MATERIAL_COMPOUND_EXTENSION_ICONS: Readonly<
  Partial<Record<string, MaterialFileIcon>>
> = {
  'd.ts': TypeScriptDefFileIcon,
  'd.cts': TypeScriptDefFileIcon,
  'd.mts': TypeScriptDefFileIcon,
  'spec.js': TestJavaScriptFileIcon,
  'spec.jsx': TestJsxFileIcon,
  'spec.ts': TestTypeScriptFileIcon,
  'stories.js': StorybookFileIcon,
  'stories.jsx': StorybookFileIcon,
  'stories.ts': StorybookFileIcon,
  'stories.tsx': StorybookFileIcon,
  'test.js': TestJavaScriptFileIcon,
  'test.jsx': TestJsxFileIcon,
  'test.ts': TestTypeScriptFileIcon,
};

export const MATERIAL_EXTENSION_ICONS: Readonly<Partial<Record<string, MaterialFileIcon>>> = {
  aab: AndroidFileIcon,
  ai: AdobeIllustratorFileIcon,
  apk: AndroidFileIcon,
  astro: AstroFileIcon,
  blend: BlenderFileIcon,
  c: CFileIcon,
  cc: CppFileIcon,
  cjs: JavaScriptFileIcon,
  cpp: CppFileIcon,
  cs: CSharpFileIcon,
  css: CssFileIcon,
  cxx: CppFileIcon,
  dart: DartFileIcon,
  doc: WordFileIcon,
  docx: WordFileIcon,
  fig: FigmaFileIcon,
  go: GoFileIcon,
  gql: GraphqlFileIcon,
  graphql: GraphqlFileIcon,
  h: HFileIcon,
  hh: HppFileIcon,
  hpp: HppFileIcon,
  hxx: HppFileIcon,
  htm: HtmlFileIcon,
  html: HtmlFileIcon,
  java: JavaFileIcon,
  jar: JarFileIcon,
  js: JavaScriptFileIcon,
  jsx: ReactFileIcon,
  kt: KotlinFileIcon,
  kts: KotlinFileIcon,
  less: LessFileIcon,
  markdown: MarkdownFileIcon,
  md: MarkdownFileIcon,
  mdx: MdxFileIcon,
  mjs: JavaScriptFileIcon,
  pdf: PdfFileIcon,
  php: PhpFileIcon,
  ppt: PowerpointFileIcon,
  pptx: PowerpointFileIcon,
  prisma: PrismaFileIcon,
  ps1: PowershellFileIcon,
  psb: AdobePhotoshopFileIcon,
  psd: AdobePhotoshopFileIcon,
  py: PythonFileIcon,
  pyi: PythonFileIcon,
  pyw: PythonFileIcon,
  rb: RubyFileIcon,
  rs: RustFileIcon,
  sass: SassFileIcon,
  scss: SassFileIcon,
  sketch: SketchFileIcon,
  sol: SolidityFileIcon,
  svelte: SvelteFileIcon,
  swift: SwiftFileIcon,
  tf: TerraformFileIcon,
  tfvars: TerraformFileIcon,
  ts: TypeScriptFileIcon,
  tsx: ReactTypeScriptFileIcon,
  unitypackage: UnityFileIcon,
  vue: VueFileIcon,
  war: JarFileIcon,
  xml: XmlFileIcon,
};

// Version and metadata come from the web app, so a release never names two versions.
const root = require('../package.json');

module.exports = {
  appId: 'io.github.stffnb.edentext',
  productName: 'EdenText',
  extraMetadata: { name: 'edentext', version: root.version, description: root.description, author: root.author, homepage: root.homepage, license: root.license },
  files: ['main.mjs', 'preload.cjs', 'package.json'],
  // Rank Alternate: macOS offers the app under Open With without taking the default.
  fileAssociations: [
    { ext: 'odt', name: 'OpenDocument Text', mimeType: 'application/vnd.oasis.opendocument.text', role: 'Editor', rank: 'Alternate' },
    { ext: 'ott', name: 'OpenDocument Text Template', mimeType: 'application/vnd.oasis.opendocument.text-template', role: 'Editor', rank: 'Alternate' },
    { ext: 'docx', name: 'Word Document', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', role: 'Editor', rank: 'Alternate' },
    { ext: 'dotx', name: 'Word Template', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template', role: 'Editor', rank: 'Alternate' },
  ],
  extraResources: [{ from: '../dist', to: 'app' }],
  // The binary cannot be reused as a Node.js interpreter, nor take options from the
  // environment; --inspect stays for the smoke test (APP=<binary>), which drives it.
  electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, grantFileProtocolExtraPrivileges: false, resetAdHocDarwinSignature: true },
  // The white tile is a macOS convention; Windows and Linux icons stand free.
  icon: '../public/icon-512.png',
  directories: { output: 'release' },
  publish: null,
  mac: { icon: 'icon.png', target: { target: 'dmg', arch: ['arm64', 'x64'] }, category: 'public.app-category.productivity' },
  win: { target: 'nsis' },
  nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
  // The tar.gz feeds the Flathub manifest, which installs the desktop entry and metainfo from it.
  linux: {
    target: ['AppImage', 'deb', { target: 'tar.gz', arch: ['x64', 'arm64'] }],
    category: 'Office',
    maintainer: root.author,
    extraFiles: [{ from: 'flatpak', to: 'flatpak', filter: ['*.desktop', '*.metainfo.xml'] }],
  },
};

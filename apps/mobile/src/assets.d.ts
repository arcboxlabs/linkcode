declare module '*.woff2' {
  const url: string;
  export default url;
}

// Android XML vector drawables, served as Metro assets for the Compose `Icon` component.
declare module '*.xml' {
  const assetId: number;
  export default assetId;
}

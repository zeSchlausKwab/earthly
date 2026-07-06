The framed surface every side/map panel is built from — header, body, optional footer.

```jsx
<Panel title="Sightings" icon={<EyeIcon/>} meta="8 nearby"
       actions={<IconButton size="sm"><PlusIcon/></IconButton>}
       footer={<Button variant="primary" style={{flex:1}}>Publish</Button>}>
  <ListRow .../>
  <ListRow .../>
</Panel>
```

`floating` adds `--shadow-panel` for panels that sit over the map (Map Stack, Basemap); docked columns leave it off and rely on the hairline border.

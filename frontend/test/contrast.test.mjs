import test from 'node:test';
import assert from 'node:assert/strict';

// Calculates WCAG relative luminance for a hexadecimal sRGB color.
function luminance(hex) {
  const channels=hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value,16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

// Returns the WCAG contrast ratio between two opaque colors.
function contrast(foreground,background) {
  const values=[luminance(foreground),luminance(background)].sort((a,b) => b-a);
  return (values[0] + .05) / (values[1] + .05);
}

test('core light and dark text palettes meet WCAG AA for normal text',() => {
  const pairs=[
    ['#eee9df','#101215','dark primary'],['#bdb6aa','#101215','dark secondary'],
    ['#29251f','#f8f3ea','light primary'],['#595149','#f8f3ea','light secondary'],
    ['#29251f','#fffdf8','light card'],['#643213','#fff4df','light warning'],
  ];
  pairs.forEach(([foreground,background,label]) => assert.ok(contrast(foreground,background) >= 4.5,`${label}: ${contrast(foreground,background).toFixed(2)}`));
});

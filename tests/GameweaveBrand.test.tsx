import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import { GameweaveBrand } from '../src/gameweave/GameweaveBrand';

afterEach(cleanup);
it('renders an accessible text fallback while the theme logo is loading',()=>{
  render(<GameweaveBrand theme="carbon-green"/>);
  expect(screen.getByText('GAMEWEAVE')).toBeTruthy();
  const image=document.querySelector<HTMLImageElement>('.gw-brand-logo');
  expect(image?.getAttribute('src')).toBe('/branding/carbon-green.webp');
  expect(image?.hidden).toBe(true);
  if(image)fireEvent.load(image);
  expect(image?.hidden).toBe(false);
});
it('switches to the matching original theme logo URL',()=>{
  const view=render(<GameweaveBrand theme="carbon-green"/>);
  view.rerender(<GameweaveBrand theme="cyan-purple"/>);
  expect(document.querySelector('.gw-brand-logo')?.getAttribute('src')).toBe('/branding/cyan-purple.webp');
  expect(screen.getByText('GAMEWEAVE')).toBeTruthy();
});

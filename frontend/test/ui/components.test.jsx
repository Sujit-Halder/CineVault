import React from 'react';
import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach,expect,it,vi } from 'vitest';
import axios from 'axios';
import MultiSelect from '../../src/components/MultiSelect';
import NotificationPanel from '../../src/components/NotificationPanel';
import DataHealth from '../../src/components/DataHealth';

vi.mock('axios',() => ({ default:{ get:vi.fn(),post:vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); });

it('grouped multiselect replaces a parent with its selected child without modifier keys',async () => {
  const user=userEvent.setup(); const change=vi.fn();
  const { rerender }=render(<MultiSelect label="Genres" grouped options={[{ name:'Drama',children:['Psychological Drama'] }]} value={['Drama']} onChange={change} />);
  await user.click(screen.getByRole('checkbox',{ name:/Psychological Drama/ }));
  expect(change).toHaveBeenLastCalledWith(['Psychological Drama']);
  rerender(<MultiSelect label="Genres" grouped options={[{ name:'Drama',children:['Psychological Drama'] }]} value={['Psychological Drama']} onChange={change} />);
  await user.click(screen.getByRole('checkbox',{ name:'Drama' }));
  expect(change).toHaveBeenLastCalledWith(['Drama']);
});

it('notification selection reports the affected title without invoking an editor directly',async () => {
  const user=userEvent.setup(); const open=vi.fn();
  const notification={ id:'notice',title:'Broken trailer title',assetType:'trailer',status:'unavailable',reason:'Video is private',read:false };
  render(<NotificationPanel notifications={[notification]} onOpen={open} onClose={vi.fn()} />);
  await user.click(screen.getByRole('button',{ name:/Unread: Broken trailer title/ }));
  expect(open).toHaveBeenCalledWith(notification);
});

it('Data Health title actions stay inside the application navigation workflow',async () => {
  const open=vi.fn();
  axios.get.mockResolvedValue({ data:{ generatedAt:new Date().toISOString(),checks:{
    missingPosters:{ label:'Entries without posters',count:1,items:[{ id:'title-one',title:'Needs a poster' }] },
    companySuggestions:[],canonicalSuggestions:[],
  } } });
  render(<DataHealth onOpen={open} />);
  const title=await screen.findByRole('button',{ name:/Needs a poster/ }); await userEvent.click(title);
  expect(open).toHaveBeenCalledWith('title-one');
});

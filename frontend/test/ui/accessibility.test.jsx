import React,{ useState } from 'react';
import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { expect,it,vi } from 'vitest';
import LibraryTable from '../../src/components/LibraryTable';
import FilterPanel from '../../src/components/FilterPanel';

const emptyFilters={ type:'',subtype:'',productionStatus:'',releaseStatus:'',viewingStatus:'',genres:[],presentationForms:[],languages:[],tags:[],rating:'',awards:[],countries:[],releaseYear:'',productionCompanies:[],watchSources:[],linkDomains:[] };
const catalogs={ countries:[],genres:[],presentationForms:{ movie:[],series:[] },subtypes:{ movie:[],series:[] },watchSources:[],linkDomains:[] };

it('the rendered audit table has no automatic axe violations',async () => {
  const { container }=render(<LibraryTable items={[{ id:'one',title:'Accessible title',type:'movie',productionStatus:'Completed',releaseStatus:'Released',viewingStatus:'Watched' }]} onEdit={vi.fn()} onBulkUpdate={vi.fn()} />);
  const results=await axe.run(container); expect(results.violations).toEqual([]);
});

it('the filter dialog closes with Escape and restores focus to its opener',async () => {
  const user=userEvent.setup();
  function Harness() { const [open,setOpen]=useState(false); return <><button onClick={() => setOpen(true)}>Open filters</button>{open && <FilterPanel filters={emptyFilters} catalogs={catalogs} awards={[]} tags={[]} ratings={[]} onChange={vi.fn()} onClose={() => setOpen(false)} />}</>; }
  render(<Harness />); const opener=screen.getByRole('button',{ name:'Open filters' }); await user.click(opener);
  expect(screen.getByRole('dialog',{ name:'Library filters' })).toBeInTheDocument(); await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(opener).toHaveFocus();
});

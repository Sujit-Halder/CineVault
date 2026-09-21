import React from 'react';
import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import LibraryTable from '../../src/components/LibraryTable';

const items=[
  { id:'one',title:'Alpha',type:'movie',subtype:'Feature Film',releaseDate:'2025-01-01',productionStatus:'Completed',releaseStatus:'Released',viewingStatus:'Watched',duration:'100',rating:'Rewatchable',countryOfOrigin:['US'],genres:['Drama'],productionCompany:'Studio',modification:'2025-01-02' },
  { id:'two',title:'Beta',type:'movie',subtype:'Feature Film',releaseDate:'2025-02-01',productionStatus:'Completed',releaseStatus:'Released',viewingStatus:'Not Watched',duration:'90',rating:'',countryOfOrigin:['GB'],genres:['Comedy'],productionCompany:'Other Studio',modification:'2025-02-02' },
];

describe('LibraryTable',() => {
  it('selects rows and submits one reviewed bulk lifecycle update',async () => {
    const user=userEvent.setup(); const update=vi.fn().mockResolvedValue(true);
    render(<LibraryTable items={items} onEdit={vi.fn()} onBulkUpdate={update} />);
    await user.click(screen.getByRole('checkbox',{ name:'Select Alpha' }));
    await user.selectOptions(screen.getByRole('combobox',{ name:'Bulk field' }),'productionStatus');
    await user.selectOptions(screen.getByRole('combobox',{ name:'Bulk value' }),'Post-Production');
    await user.click(screen.getByRole('button',{ name:'Apply' }));
    expect(update).toHaveBeenCalledWith(['one'],'productionStatus','Post-Production');
  });

  it('persists column choices and supports arrow-key row navigation',async () => {
    const user=userEvent.setup(); render(<LibraryTable items={items} onEdit={vi.fn()} onBulkUpdate={vi.fn()} />);
    await user.click(screen.getByText('Columns'));
    await user.click(screen.getByRole('checkbox',{ name:'Type' }));
    expect(screen.queryByRole('columnheader',{ name:'Type' })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('cinevault-table-columns'))).not.toContain('type');
    const rows=screen.getAllByRole('row').slice(1); rows[0].focus(); await user.keyboard('{ArrowDown}'); expect(rows[1]).toHaveFocus();
  });
});

import React from 'react';

const Logo=()=>{
    return(
        <div className='flex flex-row flex-wrap font-bold text-xl'>
            <img src='logo.png' alt='logo image' className='rounded-full w-10 h-10' />
            <p className='text-yellow-600 text-xs'>Movie</p>
            <p className='text-red-500 '>Watched</p>
        </div>
    );
};

export default Logo;
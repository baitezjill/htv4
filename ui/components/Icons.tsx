// SendIcon is removed (using text icon ✨)
// SparklesIcon is removed (using text icon 🧠)

type IconProps = { className?: string; style?: any };

export const MenuIcon = ({ className, style }: IconProps) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    fill="none" 
    viewBox="0 0 24 24" 
    strokeWidth={1.5} 
    stroke="currentColor" 
    className={className || "w-6 h-6"}
    style={style}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
  </svg>
);

export const ChevronDownIcon = ({ className, style }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className || "w-5 h-5"}
    style={style}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
  </svg>
);

export const ChevronUpIcon = ({ className, style }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className || "w-5 h-5"}
    style={style}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
  </svg>
);

export const BotIcon = ({ className, style }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className || "w-6 h-6"}
    style={style}
  >
    {/* Using the original Bot Icon Path */}
    <path fillRule="evenodd" d="M4.5 3.75a3 3 0 00-3 3v10.5a3 3 0 003 3h15a3 3 0 003-3V6.75a3 3 0 00-3-3h-15zm4.125 3a2.25 2.25 0 100 4.5 2.25 2.25 0 000-4.5zm5.25 2.25a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0zM13.5 12a1.5 1.5 0 00-1.5 1.5v1.5a1.5 1.5 0 003 0V13.5a1.5 1.5 0 00-1.5-1.5z" clipRule="evenodd" />
    <path d="M5.082 14.254a2.25 2.25 0 013.336 0l2.062 2.062a.75.75 0 001.06 0l2.062-2.062a2.25 2.25 0 013.336 0 .75.75 0 010 1.06l-3.124 3.123a2.25 2.25 0 01-3.182 0l-3.124-3.123a.75.75 0 010-1.06z" />
 </svg>
);


export const UserIcon = ({ className, style }: IconProps) => (
 <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 24 24" 
    fill="currentColor" 
    className={className || "w-6 h-6"}
    style={style}>
    <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
</svg>
);
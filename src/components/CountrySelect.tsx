import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Search, ChevronDown, Navigation } from 'lucide-react';

interface Location {
 code: string;
 name: string;
}

interface CountrySelectProps {
 locations: Location[];
 value: string;
 onChange: (value: string) => void;
 onGetLocation?: () => void;
 isLocating?: boolean;
 className?: string;
 compact?: boolean;
}

export default function CountrySelect({ locations, value, onChange, onGetLocation, isLocating, className = '', compact = false }: CountrySelectProps) {
 const [isOpen, setIsOpen] = useState(false);
 const [searchQuery, setSearchQuery] = useState('');
 const dropdownRef = useRef<HTMLDivElement>(null);

 const isCurrentLocation = value.startsWith('CURRENT_LOCATION');
 const selectedLocation = isCurrentLocation 
 ? { code: 'CURRENT_LOCATION', name: value.split(':')[1] || 'Current Location' }
 : locations.find(l => l.code === value) || locations[0];

 const filteredLocations = locations.filter(loc => 
 loc.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
 loc.code.toLowerCase().includes(searchQuery.toLowerCase())
 );

 useEffect(() => {
 const handleClickOutside = (event: MouseEvent) => {
 if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
 setIsOpen(false);
 }
 };

 document.addEventListener('mousedown', handleClickOutside);
 return () => document.removeEventListener('mousedown', handleClickOutside);
 }, []);

 return (
 <div className={`relative ${className}`} ref={dropdownRef}>
 <button
 type="button"
 onClick={() => setIsOpen(!isOpen)}
 className={`flex items-center gap-2 bg-transparent text-muted-foreground hover:text-foreground transition-colors outline-none cursor-pointer ${compact ? 'py-1' : 'py-2'}`}
 >
 {isCurrentLocation ? (
 <Navigation className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-accent`} />
 ) : (
 <MapPin className={`${compact ? 'w-4 h-4' : 'w-5 h-5'} text-muted-foreground`} />
 )}
 <span className={`truncate font-medium ${compact ? 'max-w-[80px] text-sm' : 'max-w-[120px]'}`}>
 {compact ? (isCurrentLocation ? 'Local' : selectedLocation.code) : selectedLocation.name}
 </span>
 <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
 </button>

 <AnimatePresence>
 {isOpen && (
 <motion.div
 initial={{ opacity: 0, y: 10, scale: 0.95 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, y: 10, scale: 0.95 }}
 transition={{ duration: 0.15 }}
 className="absolute top-full right-0 mt-2 w-64 bg-card border border-border rounded-xl shadow-2xl z-50 overflow-hidden"
 >
 <div className="p-2 border-b border-border">
 <div className="relative">
 <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"/>
 <input
 type="text"
 placeholder="Search countries..."
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full bg-muted/50 border border-border rounded-lg py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
 autoFocus
 />
 </div>
 </div>
 <div className="max-h-60 overflow-y-auto py-1 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/50">
 {onGetLocation && (
 <button
 type="button"
 onClick={() => {
 onGetLocation();
 setIsOpen(false);
 setSearchQuery('');
 }}
 disabled={isLocating}
 className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-muted transition-colors ${isCurrentLocation ? 'text-accent bg-accent/10' : 'text-accent'}`}
 >
 <Navigation className={`w-4 h-4 ${isLocating ? 'animate-pulse' : ''}`} />
 <span className="font-medium">{isLocating ? 'Locating...' : 'Use Current Location'}</span>
 </button>
 )}
 {filteredLocations.length > 0 ? (
 filteredLocations.map(loc => (
 <button
 key={loc.code}
 type="button"
 onClick={() => {
 onChange(loc.code);
 setIsOpen(false);
 setSearchQuery('');
 }}
 className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-muted transition-colors ${value === loc.code ? 'text-accent bg-accent/10 font-medium' : 'text-foreground'}`}
 >
 <span>{loc.name}</span>
 <span className="text-xs text-muted-foreground">{loc.code}</span>
 </button>
 ))
 ) : (
 <div className="px-4 py-3 text-sm text-muted-foreground text-center">
 No countries found
 </div>
 )}
 </div>
 </motion.div>
 )}
 </AnimatePresence>
 </div>
 );
}

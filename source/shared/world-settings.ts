import type {SettingDefinition} from './settings.ts';

export const WORLD_DEFAULT_SETTINGS=Object.freeze({
  enabled:true,ambientHostility:65,gangAggression:75,civilianPanic:70,
  eventIntervalSeconds:75,maxActiveEvents:2,maxSpawnedPeds:16,
  turfWars:true,streetFights:true,ambientTaunts:true,tacticalRetreat:true,
  blips:true,subtitles:true,protectMissions:true,
});
export const WORLD_SETTING_RANGES: Readonly<Record<string,[number,number,number]>>=Object.freeze({
  ambientHostility:[0,100,1],gangAggression:[0,100,1],civilianPanic:[0,100,1],
  eventIntervalSeconds:[30,300,1],maxActiveEvents:[1,3,1],maxSpawnedPeds:[4,24,1],
});
const tips:Record<keyof typeof WORLD_DEFAULT_SETTINGS,string>={
  enabled:'Enable autonomous world encounters, including street fights and gang turf battles.',
  ambientHostility:'Intensity of local confrontations and aggressive ambient reactions.',
  gangAggression:'Aggression used by the bounded, mod-owned gang encounter director.',
  civilianPanic:'Civilian sensitivity to nearby threats during owned encounters.',
  eventIntervalSeconds:'Minimum seconds between autonomous world encounters.',
  maxActiveEvents:'Maximum simultaneous encounters owned by the world director.',
  maxSpawnedPeds:'Maximum pedestrians created and owned by the world director.',
  turfWars:'Enable gang territory battles with observed outcomes and campaign persistence.',
  streetFights:'Enable bounded street-fight encounters near the player.',
  ambientTaunts:'Enable confrontation taunts associated with the world director.',
  tacticalRetreat:'Allow an outmatched, mod-owned gang group to retreat.',
  blips:'Display markers for active world encounters owned by this mod.',
  subtitles:'Display dialogue and event subtitles from the world director.',
  protectMissions:'Pause world encounters while a protected Story mission is active.',
};
export const WORLD_MENU_CATALOG: readonly SettingDefinition[]=Object.freeze(Object.entries(WORLD_DEFAULT_SETTINGS).map(([key,value])=>{
  const range=WORLD_SETTING_RANGES[key];
  return Object.freeze({key:`world.${key}`,label:key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase()),group:'World director',type:typeof value==='boolean'?'boolean' as const:'number' as const,default:value,...(range?{min:range[0],max:range[1],step:range[2]}:{}),tooltip:tips[key as keyof typeof WORLD_DEFAULT_SETTINGS],consumer:'game' as const});
}));

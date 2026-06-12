// themes.js — palette + style descriptors. The game now ships a single world:
// Glow · cosmos (star buddies). The engine reads this to color/draw everything.
window.THEMES = {
  glow: {
    key: 'glow',
    label: 'Glow · cosmos',
    dotStyle: 'star',
    bgTop: '#2a1a6b', bgBot: '#120a2c',
    grid: 'rgba(255,255,255,0.08)',
    dotBody: '#FFE14C', dotBodyDark: '#e0b41f', dotShine: '#fff7cf',
    dotEye: '#7a4a00', leaf: '#38E1FF',
    threatBody: '#C026A3', threatBodyDark: '#6a1b66', threatEye: '#2a0a26',
    reward: '#FF54C8', rewardDark: '#c0249b', rewardCore: '#ffffff',
    lineGlow: '#38E1FF', lineCore: '#dffaff',
    pip: '#38E1FF', pipEmpty: 'rgba(255,255,255,0.22)',
    threatParticles: ['#C026A3', '#FF54C8', '#B6FF4C', '#38E1FF'],
    plantParticles: ['#FFE14C', '#38E1FF', '#fff7cf'],
    hudInk: '#dffaff', hudInkSoft: 'rgba(223,250,255,0.6)',
    panelBg: 'rgba(26,17,69,0.62)', panelBorder: 'rgba(120,90,224,0.4)',
    flash: 'rgba(120,225,255,0.5)', dark: true,
    starfield: true,
  },
};

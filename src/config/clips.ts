import { Clip, ClipCategory } from '../types';

/**
 * Default Prompt Modifier Clips
 * 
 * Organized by category. Can be customized by adding/modifying categories or entries.
 */
export const DEFAULT_CLIPS: Record<ClipCategory, Clip[]> = {
  scene: [
    { id: 'scene-golden', label: 'Golden Hour', modifier: 'golden hour outdoors, warm sunlight, long shadows, backlit glow', isBuiltIn: true },
    { id: 'scene-urban', label: 'Urban Night', modifier: 'urban nighttime cityscape, neon reflections, wet streets, moody atmosphere', isBuiltIn: true },
    { id: 'scene-forest', label: 'Foggy Forest', modifier: 'misty forest, fog drifting between trees, soft diffused light, ethereal mood', isBuiltIn: true },
    { id: 'scene-coastal', label: 'Coastal Cliffs', modifier: 'dramatic coastal cliffs, crashing waves, ocean spray, golden light on rocks', isBuiltIn: true },
  ],
  expression: [
    { id: 'expr-confident', label: 'Confident Smile', modifier: 'confident subtle smile, direct eye contact, self-assured expression', isBuiltIn: true },
    { id: 'expr-contemplative', label: 'Contemplative', modifier: 'contemplative expression, thoughtful gaze, introspective mood', isBuiltIn: true },
    { id: 'expr-laughing', label: 'Laughing', modifier: 'genuine laughter, joyful expression, candid moment, natural happiness', isBuiltIn: true },
    { id: 'expr-serene', label: 'Serene', modifier: 'serene peaceful expression, calm composure, soft closed-lip smile', isBuiltIn: true },
  ],
  pose: [
    { id: 'pose-3q', label: 'Three-Quarter', modifier: 'three-quarter turn pose, angled body, dynamic composition', isBuiltIn: true },
    { id: 'pose-shoulder', label: 'Over Shoulder', modifier: 'over-the-shoulder glance, looking back, elegant twist', isBuiltIn: true },
    { id: 'pose-walking', label: 'Walking Motion', modifier: 'mid-stride walking pose, natural movement, motion blur hint', isBuiltIn: true },
    { id: 'pose-leaning', label: 'Leaning Casual', modifier: 'casually leaning against wall, relaxed posture, effortless cool', isBuiltIn: true },
  ],
  outfit: [
    { id: 'outfit-street', label: 'Streetwear', modifier: 'modern streetwear, oversized hoodie, sneakers, urban fashion', isBuiltIn: true },
    { id: 'outfit-formal', label: 'Formal Suit', modifier: 'tailored formal suit, crisp shirt, polished shoes, sophisticated elegance', isBuiltIn: true },
    { id: 'outfit-flowing', label: 'Flowing Dress', modifier: 'flowing elegant dress, fabric catching wind, graceful draping', isBuiltIn: true },
    { id: 'outfit-athletic', label: 'Athleisure', modifier: 'athletic athleisure wear, fitted leggings, sport top, activewear aesthetic', isBuiltIn: true },
  ],
  lighting: [
    { id: 'light-rim', label: 'Cinematic Rim', modifier: 'cinematic rim lighting, dramatic backlight, silhouette edge glow', isBuiltIn: true },
    { id: 'light-diffused', label: 'Soft Diffused', modifier: 'soft diffused lighting, overcast sky, even illumination, no harsh shadows', isBuiltIn: true },
    { id: 'light-neon', label: 'Neon Glow', modifier: 'neon glow lighting, vibrant colored light, cyberpunk atmosphere, light reflections on skin', isBuiltIn: true },
    { id: 'light-window', label: 'Window Light', modifier: 'natural window light, side-lit, soft shadows, warm interior ambiance', isBuiltIn: true },
  ],
  style: [
    { id: 'style-35mm', label: '35mm Film', modifier: '35mm film photography, analog vibe, subtle grain, Kodak Portra 400, depth of field', isBuiltIn: true },
    { id: 'style-raw', label: 'RAW Photo', modifier: 'RAW photorealistic, sharply focused, studio lighting, hyper-realistic texture', isBuiltIn: true },
    { id: 'style-polaroid', label: 'Polaroid', modifier: 'polaroid aesthetic, instant camera, soft lighting, vintage feel, faded colors', isBuiltIn: true },
    { id: 'style-editorial', label: 'Editorial', modifier: 'editorial magazine photography, high fashion, professional retouching, Vogue aesthetic', isBuiltIn: true },
  ],
  framing: [
    { id: 'frame-full', label: 'Full Body', modifier: 'full-body portrait shot, subject visible head-to-toe, wide environmental framing, professional focal length', isBuiltIn: true },
    { id: 'frame-medium', label: 'Medium Shot', modifier: 'medium shot, waist-up framing, natural posture, balanced composition of subject and background', isBuiltIn: true },
    { id: 'frame-closeup', label: 'Close-Up', modifier: 'close-up headshot portrait, head and shoulders framing, sharp focus on eyes, beautiful shallow depth of field', isBuiltIn: true },
    { id: 'frame-environmental', label: 'Environmental', modifier: 'environmental portraiture, wide-angle lens, subject placed in context of their surroundings, cinematic composition', isBuiltIn: true },
    { id: 'frame-low', label: 'Low-Angle Hero', modifier: 'low-angle perspective, shot looking slightly upward, powerful stature, dynamic focal length', isBuiltIn: true },
  ],
  atmosphere: [
    { id: 'atmos-heavyrain', label: 'Heavy Rain', modifier: 'heavy rain, wet surfaces, rain streaks in air, reflections on asphalt, moody atmosphere', isBuiltIn: true },
    { id: 'atmos-damp', label: 'Damp Post-Rain', modifier: 'drizzling rain, damp streets, soft reflections, high humidity, clean post-rain atmosphere', isBuiltIn: true },
    { id: 'atmos-mist', label: 'Morning Mist', modifier: 'soft morning mist, light atmospheric haze, sunbeams filtering through, gentle depth', isBuiltIn: true },
    { id: 'atmos-overcast', label: 'Overcast Grey', modifier: 'overcast sky, grey day, soft diffused atmosphere, gentle shadows, natural realistic mood', isBuiltIn: true },
    { id: 'atmos-golden', label: 'Golden Late Afternoon', modifier: 'soft golden hour, late afternoon sunlight, warm solar flare, gentle light leaks, romantic atmosphere', isBuiltIn: true },
  ],
  complexion: [
    { id: 'comp-freckles', label: 'Freckled / Sun-Kissed', modifier: 'natural skin texture with visible freckles, sun-kissed complexion, subtle organic skin pores', isBuiltIn: true },
    { id: 'comp-wrinkles', label: 'Weathered / Mature', modifier: 'deep character lines, seasoned wrinkled skin, weathered texture, detailed facial lines, expressive maturity', isBuiltIn: true },
    { id: 'comp-dewy', label: 'Dewy / Radiant', modifier: 'dewy glowing skin, radiant complexion, clean natural highlights, fresh and healthy skin finish', isBuiltIn: true },
    { id: 'comp-matte', label: 'Smooth Matte', modifier: 'clean matte complexion, smooth even skin tone, soft focus texture, elegant portrait finish', isBuiltIn: true },
    { id: 'comp-melanin', label: 'Melanin-Rich / Glowing', modifier: 'rich dark complexion, warm undertones, beautiful highlights, glowing skin luster', isBuiltIn: true },
    { id: 'comp-rosy', label: 'Rosy / Fair', modifier: 'fair complexion, soft rosy undertones, delicate skin texture, natural flush', isBuiltIn: true },
  ],
};

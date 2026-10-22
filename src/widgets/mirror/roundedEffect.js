import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

/**
 * Clips an actor's content to a square with rounded corners (radius 9% of the side), with a
 * soft edge. Used for the enlarged webcam preview (the content must be square).
 */
export const RoundedEffect = GObject.registerClass({
    GTypeName: 'OsminRoundedEffect',
}, class RoundedEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, '', `
            vec2 osmin_p = abs(cogl_tex_coord_in[0].xy - vec2(0.5)) - vec2(0.5 - 0.09);
            float osmin_d = length(max(osmin_p, vec2(0.0))) + min(max(osmin_p.x, osmin_p.y), 0.0) - 0.09;
            cogl_color_out *= 1.0 - smoothstep(-0.006, 0.004, osmin_d);
        `, false);
    }
});

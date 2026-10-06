import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

/**
 * Clips an actor's content to the circle inscribed in its box, with a soft
 * edge. Used for the round webcam preview (the content must be square).
 */
export const CircleEffect = GObject.registerClass({
    GTypeName: 'OsminCircleEffect',
}, class CircleEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, '', `
            vec2 osmin_p = cogl_tex_coord_in[0].xy - vec2(0.5);
            float osmin_edge = 1.0 - smoothstep(0.485, 0.5, length(osmin_p));
            cogl_color_out *= osmin_edge;
        `, false);
    }
});

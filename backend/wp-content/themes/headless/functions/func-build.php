<?php
/**
 * Group functions related to building Gatsby
 *
 * @package Custom Headless 
 */

/**
 * Add the 'Publish Changes' button to the wordpress admin bar
 *
 * @package Custom Headless 
 */
function Custom_admin_bar_menu($admin_bar) {
    if ($_SERVER['SERVER_NAME'] == CMS_DOMAIN) {
        $admin_bar->add_menu( array(
            'id'    => 'publish-changes',
            'title' => 'Publish Changes',
            'href'  => '#',
            'meta'  => array(
                'title' => __('Click to publish changes to frontend site'),
            ),
        ));
    }
}
add_action('admin_bar_menu', 'Custom_admin_bar_menu', 100);



/**
 * Enqueue admin scripts and styles
 *
 * @package Custom Headless 
 */
function Custom_load_custom_wp_admin($hook_suffix) {

    wp_register_script( 'Custom_admin_scripts', get_stylesheet_directory_uri() . '/assets/js/admin.js', array('jquery'), '1.0.1', false );
    wp_register_style( 'Custom_admin_css', get_template_directory_uri() . '/assets/css/admin.css', false, '1.0.1' );
    wp_enqueue_style( 'Custom_admin_css' );

    wp_enqueue_script( 'Custom_admin_scripts' );

    wp_localize_script( 'Custom_admin_scripts', 'Custom_vars', array(
            'nonce'    => wp_create_nonce( 'Custom_publish_changes' ),
            'ajax_url' => admin_url( 'admin-ajax.php' ),
        )
    );
}
add_action( 'admin_enqueue_scripts', 'Custom_load_custom_wp_admin' );


/**
 * This is the function that is called via ajax when the PUBLISH button in the admin bar is clicked
 * This triggers a webhook call to amplify which pulls the latest from github and builds the website
 *
 * @package Custom Headless 
 */
function Custom_build($ajax=true) {
    if ($ajax) check_ajax_referer( 'Custom_publish_changes', 'security' );
    
    $url = FALSE;
    if ($_SERVER['SERVER_NAME'] == CMS_DOMAIN)
    {
        $url = get_field('build_webhook', 'options');
    } 

    if ($url && wp_http_validate_url($url)) {
        // Requests::post($url); doesnt work?

        $curl = curl_init($url);
        curl_setopt($curl, CURLOPT_URL, $url);
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
        
        $headers = array(
           "Content-Type: application/json",
        );
        curl_setopt($curl, CURLOPT_HTTPHEADER, $headers);
        
        $data = "{}";
        
        curl_setopt($curl, CURLOPT_POSTFIELDS, $data);
        
        //for debug only!
        curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, false);
        curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, false);
        
        $resp = curl_exec($curl);
        curl_close($curl);
        
        print"Rebuild requested ok";
    } else {
        print"Rebuild failed. Webhook URL for manual rebuild needs to be completed on the Options page";        
    }

    wp_die();
}
add_action('wp_ajax_Custom_build', 'Custom_build');

/* 
    Triggers when scheduled post is published
*/
function future_post( $new_status, $old_status, $post ) {
    if ( ( 'publish' === $new_status && 'future' === $old_status ) && in_array($post->post_type, array(
        'post', 
        'page', 
    )) ) {
        Custom_build(false);
    }
}
add_action( 'transition_post_status', 'future_post', 10, 3 );



/**
 * This code automatically triggers a build when any post is updated.
 * 
 */
// function Custom_build_on_save($post_id) {
//     if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) {
//         return;
//     }
    
//     //whether we want to automatically rebbuild is set n the options page
//     if (get_field('amplify_automatic_build', 'options')) {
        
        
//         $url = get_field('amplify_automatic_build_webhook_url', 'options');
//         if (wp_http_validate_url($url)) {
//             Requests::post($url);
//         }
//     }
// }
// add_action('save_post', 'Custom_build_on_save');
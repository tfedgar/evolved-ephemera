<?php
if ( ! function_exists( 'Custom_setup' ) ) {

	/**
	 * Sets up theme defaults and registers support for various WordPress features.
	 *
     * @package Custom Headless 
	 */
    function Custom_setup() {

		// Enable post thumbnails for pages
        add_theme_support( 'post-thumbnails', array( 'page', 'post', 'player' ) );

		// Add default posts RSS feed links to head
		//add_theme_support( 'automatic-feed-links' );

		//Let WordPress manage the document title.
		add_theme_support( 'title-tag' );

		// This theme uses wp_nav_menu() in two locations.
		register_nav_menus( array(
		    'primary'       => 'Primary',
            'primary-full'  => 'Primary Full',
            'primary-full-sub'  => 'Primary Full Sub',
            'footer1'      => 'Footer 1',
            'footer2'      => 'Footer 2',
            'footer3'      => 'Footer 3',
            'footer4'      => 'Footer 4'
        ) );

        // Add custom image sizes based on bootstrap breakpoints
        // 0 for auto height
        add_image_size( 'imagesize_xxxl', 1920, 0, true );
        add_image_size( 'imagesize_xxl', 1600, 0 );
        add_image_size( 'imagesize_xl', 1200, 0 );
        add_image_size( 'imagesize_lg', 992, 0 );
        add_image_size( 'imagesize_md', 768, 0 );
        add_image_size( 'imagesize_sm', 576, 0 );

        add_image_size( 'featured_image_45', 460, 575, true );
	}
}
add_action( 'after_setup_theme', 'Custom_setup' );

/**
 * Backend: remove the 'My Apps Passwords' submenu added by 'WP Google Authenticator' plugin.
 *
 * @package Custom Headless 
 */
function Custom_admin_menu()
{

    //remove posts
    //remove_menu_page('edit.php');

    //remove the 'My Apps Passwords' submenu added by 'WP Google Authenticator' plugin.
    remove_submenu_page( 'users.php', 'wpga_apps_passwords' );

}
add_action('admin_menu', 'Custom_admin_menu');


function dcwd_youtube_wrapper( $html, $url, $attr, $post_ID ) {
	$classes[] = 'embed-responsive embed-responsive-16by9';
    return '<div class="' . implode( ' ', $classes ) . '">' . $html . '</div>';
}
add_filter( 'embed_oembed_html', 'iframe_wrapper', 10, 4 );


function my_prefix_add_rest_orderby_params( $params ) {
    $params['orderby']['enum'][] = 'menu_order';

    return $params;
}
add_filter( 'rest_post_collection_params', 'my_prefix_add_rest_orderby_params', 10, 1 );

// remove yoast taxonmy error
add_filter( 'wpseo_primary_term_taxonomies', '__return_empty_array' );

// hide posts as not using
function remove_menu_items() {
    remove_menu_page('edit.php'); // Posts
    remove_menu_page('edit.php?post_type=action_monitor'); // action_monitor
}
add_action( 'admin_menu', 'remove_menu_items' );

function wpse_custom_menu_order( $menu_ord ) {
    if ( !$menu_ord ) return true;

    return array(
        'index.php', // Dashboard
        'separator1', // First separator
        'upload.php', // Media
        'edit.php?post_type=page', // Pages
        'edit.php?post_type=news', // news
        'edit.php?post_type=restaurants',
        'edit.php?post_type=chefs', 
        'edit.php?post_type=tastemenus', 
        'edit.php?post_type=dishes', 
        'edit.php?post_type=recipes', 
        'edit.php?post_type=artisanproducers',
        'edit.php?post_type=thingstodo',
        'edit.php?post_type=theres-more',
        'edit.php?post_type=ticket', 
        'edit.php?post_type=galleries', 
        'edit.php?post_type=schedule', 
        'edit.php?post_type=sidebarblocks', 
        'edit.php?post_type=tastemap', 
        'edit.php?post_type=urgencylabel', 
        'separator2', // Second separator
        'themes.php', // Appearance
        'plugins.php', // Plugins
        'users.php', // Users
        'tools.php', // Tools
        'options-general.php', // Settings
        'separator-last', // Last separator
    );
}
add_filter( 'custom_menu_order', 'wpse_custom_menu_order', 10, 1 );
add_filter( 'menu_order', 'wpse_custom_menu_order', 10, 1 );

// shove YOAST settings panel in editor to bottom 
add_filter( 'wpseo_metabox_prio', function() { return 'low'; } );

function edit_upload_types($existing_mimes = array()) {
    // allow .woff
    // $existing_mimes['svg'] = 'image/svg+xml';
 
    // add as many as you want with the same syntax
 
    // disallow .jpg files
    unset( $existing_mimes['webp'] );
    unset( $existing_mimes['gif'] );
    // unset( $existing_mimes['svg'] );
 
    return $existing_mimes;
}
add_filter('upload_mimes', 'edit_upload_types');



//  * Increase perPage for product categories. This is needed to build out the sidebar accordion.
add_filter( 'graphql_connection_max_query_amount', function ( int $max_amount, $source, array $args, $context, $info ) {
	// Bail if the fieldName isn't avail
	if ( empty( $info->fieldName ) ) {
		return $max_amount;
	}
	// Bail if we're not dealing with our target fieldName
	if ( 'artisanproducers' !== $info->fieldName ) {
		return $max_amount;
	}
	return 200;
}, 10, 5 );

// Set image alt text from the image caption on upload
add_action('add_attachment', function($attachment_id) {
    $post = get_post($attachment_id);

    if ($post && $post->post_type === 'attachment') {
        // Get caption (from IPTC/XMP metadata, stored as post_excerpt)
        $caption = $post->post_excerpt;

        if (!empty($caption)) {
            // Sanitize and set as alt text
            $alt = sanitize_text_field($caption);
            update_post_meta($attachment_id, '_wp_attachment_image_alt', $alt);
        }
    }
});
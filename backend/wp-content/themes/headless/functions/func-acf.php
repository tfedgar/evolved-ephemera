<?php
/**
 * Include ACF
 *
 * @package Custom Headless 
 */

/**
 * Add options page with ACF
 *
 * @package Custom Headless 
 */
if ( function_exists('acf_add_options_page') ) {

    acf_add_options_page(
        array(
            'page_title'      => __( 'Options' ),
            'menu_title'      => __( 'Options' ),
            'menu_slug'       => 'options',
            'capability'      => 'edit_posts',
            'show_in_graphql' => true,
        )
    );
    
    acf_add_options_page(
        array(
            'page_title'      => __( 'Devops' ),
            'menu_title'      => __( 'Devops' ),
            'menu_slug'       => 'devops',
            'capability'      => 'edit_posts'
        )
    );

    $languages = array();

	if (function_exists('pll_languages_list')) {

		$translations = pll_languages_list();
		if ($translations) {
			foreach ($translations as $t) {
				$languages[] = $t;
			}
		}

	}

	foreach ( $languages as $lang ) {
		acf_add_options_sub_page( array(
			'page_title' => "Options - ".strtoupper( $lang ),
			'menu_title' => __('Options (' . strtoupper( $lang ) . ')', 'text-domain'),
			'menu_slug'  => "options-${lang}",
            'parent_slug'     => "options",
            'post_id' => $lang,
            'show_in_graphql' => true
		) );
	}

}


// Hide ACF field group menu item from all users apart from super admin
if ( ! current_user_can( 'administrator' ) ) {
	add_filter('acf/settings/show_admin', '__return_false');
}


if (!function_exists('Custom_nullify_empty')) {
    /**
     * Return `null` if an empty value is returned from ACF.
     *
     * @param mixed $value
     * @param mixed $post_id
     * @param array $field
     *
     * @return mixed
     */
    function Custom_nullify_empty($value, $post_id, $field) {
        if (empty($value)) {
            return null;
        }
        return $value;
	}
	
    add_filter('acf/format_value', 'Custom_nullify_empty', 100, 3);
}

//https://www.advancedcustomfields.com/resources/dynamically-populate-a-select-fields-choices/

/**
 * hide the dummy acf ticket form the tickets relationship field in blocks
 */
function Custom_hide_dummy_ticket( $args, $field, $post_id ) {
    $args['post__not_in'] = array( 506 );//'Dummy ACF content'    
    return $args;
}
add_filter( 'acf/fields/relationship/query/key=field_5e307cb2d50d4', 'Custom_hide_dummy_ticket', 10, 3 );

/**
 * hide the dummy acf ticket form the tickets relationship field in blocks
 */
function Custom_hide_dummy_sidebar( $args, $field, $post_id ) {
    $args['post__not_in'] = array( 510 );//'Dummy ACF content'    
    return $args;
}
add_filter( 'acf/fields/relationship/query/key=field_5d5a8e825e89d', 'Custom_hide_dummy_sidebar', 10, 3 );

// // Fix bug to show field groups on pages
// function whitelistedFieldGroups( $result, $rule, $screen, $field_group) {
// 	$graphqlFieldNames = [
//         'acfFlexibleContent',
//     ];

// 	if (
// 		in_array($field_group['graphql_field_name'], $graphqlFieldNames)
// 		&& $screen['post_type'] === 'page'
// 	) {
// 		return true;
// 	}

// 	return $result;
// }
// add_filter('acf/location/rule_match', 'whitelistedFieldGroups', 10, 4);


function my_mce4_options($init) {
    $default_colours = '"000000", "Black",
                        "993300", "Burnt orange",
                        "333300", "Dark olive",
                        "003300", "Dark green",
                        "003366", "Dark azure",
                        "000080", "Navy Blue",
                        "333399", "Indigo",
                        "333333", "Very dark gray",
                        "800000", "Maroon",
                        "FF6600", "Orange",
                        "808000", "Olive",
                        "008000", "Green",
                        "008080", "Teal",
                        "0000FF", "Blue",
                        "666699", "Grayish blue",
                        "808080", "Gray",
                        "FF0000", "Red",
                        "FF9900", "Amber",
                        "99CC00", "Yellow green",
                        "339966", "Sea green",
                        "33CCCC", "Turquoise",
                        "3366FF", "Royal blue",
                        "800080", "Purple",
                        "999999", "Medium gray",
                        "FF00FF", "Magenta",
                        "FFCC00", "Gold",
                        "FFFF00", "Yellow",
                        "00FF00", "Lime",
                        "00FFFF", "Aqua",
                        "00CCFF", "Sky blue",
                        "993366", "Red violet",
                        "FFFFFF", "White",
                        "FF99CC", "Pink",
                        "FFCC99", "Peach",
                        "FFFF99", "Light yellow",
                        "CCFFCC", "Pale green",
                        "CCFFFF", "Pale cyan",
                        "99CCFF", "Light sky blue",
                        "CC99FF", "Plum"';
  
    // build colour grid default+custom colors
    $init['textcolor_map'] = '['.$default_colours.']';
  
    // enable 6th row for custom colours in grid
    $init['textcolor_rows'] = 6;
  
    return $init;
  }
  add_filter('tiny_mce_before_init', 'my_mce4_options');



// Only show published content in relationship fields
function relationship_options_filter($options, $field, $the_post) {
	$options['post_status'] = array('publish');
	
	return $options;
}

add_filter( 'acf/fields/relationship/query','relationship_options_filter', 10, 3);
#!/bin/bash
#
# ARG_HELP([Uses ffmpeg to capture only frames with movement above a specific threshold to a new video])
# ARG_OPTIONAL_SINGLE([threshold],[t],[motion threshold that triggers a capture],[0.005])
# ARG_OPTIONAL_SINGLE([framerate],[f],[output highlight file framerate],[16])
# ARG_POSITIONAL_INF([files],[one or more (with wildcard) files to highlight],[1])
# ARGBASH_GO()
# needed because of Argbash --> m4_ignore([
### START OF CODE GENERATED BY Argbash v2.8.1 one line above ###
# Argbash is a bash code generator used to get arguments parsing right.
# Argbash is FREE SOFTWARE, see https://argbash.io for more info
# Generated online by https://argbash.io/generate


die()
{
	local _ret=$2
	test -n "$_ret" || _ret=1
	test "$_PRINT_HELP" = yes && print_help >&2
	echo "$1" >&2
	exit ${_ret}
}


begins_with_short_option()
{
	local first_option all_short_options='htf'
	first_option="${1:0:1}"
	test "$all_short_options" = "${all_short_options/$first_option/}" && return 1 || return 0
}

# THE DEFAULTS INITIALIZATION - POSITIONALS
_positionals=()
_arg_files=('' )
# THE DEFAULTS INITIALIZATION - OPTIONALS
_arg_threshold="0.005"
_arg_framerate="16"


print_help()
{
	printf '%s\n' "Uses ffmpeg to capture only frames with movement above a specific threshold to a new video"
	printf 'Usage: %s [-h|--help] [-t|--threshold <arg>] [-f|--framerate <arg>] <files-1> [<files-2>] ... [<files-n>] ...\n' "$0"
	printf '\t%s\n' "<files>: one or more (with wildcard) files to highlight"
	printf '\t%s\n' "-h, --help: Prints help"
	printf '\t%s\n' "-t, --threshold: motion threshold that triggers a capture (default: '0.005')"
	printf '\t%s\n' "-f, --framerate: output highlight file framerate (default: '16')"
}


parse_commandline()
{
	_positionals_count=0
	while test $# -gt 0
	do
		_key="$1"
		case "$_key" in
			-h|--help)
				print_help
				exit 0
				;;
			-h*)
				print_help
				exit 0
				;;
			-t|--threshold)
				test $# -lt 2 && die "Missing value for the optional argument '$_key'." 1
				_arg_threshold="$2"
				shift
				;;
			--threshold=*)
				_arg_threshold="${_key##--threshold=}"
				;;
			-t*)
				_arg_threshold="${_key##-t}"
				;;
			-f|--framerate)
				test $# -lt 2 && die "Missing value for the optional argument '$_key'." 1
				_arg_framerate="$2"
				shift
				;;
			--framerate=*)
				_arg_framerate="${_key##--framerate=}"
				;;
			-f*)
				_arg_framerate="${_key##-f}"
				;;
			*)
				_last_positional="$1"
				_positionals+=("$_last_positional")
				_positionals_count=$((_positionals_count + 1))
				;;
		esac
		shift
	done
}


handle_passed_args_count()
{
	local _required_args_string="'files'"
	test "${_positionals_count}" -ge 1 || _PRINT_HELP=yes die "FATAL ERROR: Not enough positional arguments - we require at least 1 (namely: $_required_args_string), but got only ${_positionals_count}." 1
}


assign_positional_args()
{
	local _positional_name _shift_for=$1
	_positional_names="_arg_files "
	_our_args=$((${#_positionals[@]} - 1))
	for ((ii = 0; ii < _our_args; ii++))
	do
		_positional_names="$_positional_names _arg_files[$((ii + 1))]"
	done

	shift "$_shift_for"
	for _positional_name in ${_positional_names}
	do
		test $# -gt 0 || break
		eval "$_positional_name=\${1}" || die "Error during argument parsing, possibly an Argbash bug." 1
		shift
	done
}

parse_commandline "$@"
handle_passed_args_count
assign_positional_args 1 "${_positionals[@]}"

# OTHER STUFF GENERATED BY Argbash

### END OF CODE GENERATED BY Argbash (sortof) ### ])
# [ <-- needed because of Argbash

for f in $_arg_files; do
  if [[ $f =~ (.*)\.mp4$ ]]; then
    echo "Highlighting ${f} at $_arg_threshold threshold"
    _output=${BASH_REMATCH[1]}
    _output_file=${_output}-highlight.mp4
    ffmpeg -y -i $f -nostdin -loglevel panic -filter \
      "select=gt(scene\,$_arg_threshold),setpts=N/($_arg_framerate*TB)" \
      -pix_fmt yuv420p ${_output_file}
    _length=$(printf "%.0f" $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $_output_file))
    if [ $_length -eq 0 ]; then
      echo "No motion captured for highlight at $_arg_threshold"
      rm $_output_file
    fi
  fi
done

# ] <-- needed because of Argbash